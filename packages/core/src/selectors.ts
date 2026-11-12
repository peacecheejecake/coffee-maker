import { isWorkdayFor } from './calendar';
import { creditGrade, type CreditGrade } from './credit';
import type { EventId, PlayerId } from './ids';
import { computeCups, judgeLateness, type Judgement } from './judge';
import type { Player } from './player';
import { DEFAULT_RULESET, type Ruleset } from './ruleset';
import { motionStatus } from './motion';
import { attendanceKey, type LateRecord, type LedgerState, type MotionRecord, type Redemption, type WaiveProposal } from './state';
import { addDays, wallTimeAt, type HHmm, type Instant, type WorkDate } from './time';
import { proposalStatus } from './waive';

export const activePlayers = (s: LedgerState): Player[] =>
  s.playerOrder.flatMap((id) => {
    const p = s.players[id];
    return p && !p.archived ? [p] : [];
  });

/** Ruleset in force on `date`: the latest change whose effectiveFrom is on or before it. */
export function rulesetAt(s: LedgerState, date: WorkDate): Ruleset {
  let found: Ruleset | undefined;
  for (const entry of s.rulesets) {
    if (entry.effectiveFrom > date) break;
    found = entry.ruleset;
  }
  return found ?? s.rulesets[0]?.ruleset ?? DEFAULT_RULESET;
}

export const currentRuleset = (s: LedgerState): Ruleset => s.rulesets.at(-1)?.ruleset ?? DEFAULT_RULESET;

export const outstanding = (s: LedgerState, playerId: PlayerId): number => s.towers[playerId]?.cups.length ?? 0;

export const lateRecordsOf = (s: LedgerState, playerId: PlayerId): LateRecord[] =>
  s.lateOrder.flatMap((id) => {
    const r = s.lates[id];
    return r && r.playerId === playerId ? [r] : [];
  });

export const activeLateOn = (s: LedgerState, playerId: PlayerId, date: WorkDate): LateRecord | undefined =>
  lateRecordsOf(s, playerId).find((r) => r.status === 'active' && r.workDate === date);

export const redemptionsOf = (s: LedgerState, debtorId: PlayerId): Redemption[] =>
  s.redemptionOrder.flatMap((id) => {
    const r = s.redemptions[id];
    return r && r.debtorId === debtorId ? [r] : [];
  });

/** Cups paid for that no longer correspond to any debt (waived/corrected after payment, or raced). */
export function overpaid(s: LedgerState, playerId: PlayerId): number {
  const fromRecords = lateRecordsOf(s, playerId).reduce(
    (sum, r) => sum + Math.max(0, r.redeemed - (r.status === 'active' ? r.cups : 0)),
    0,
  );
  return fromRecords + (s.unappliedRedeemed[playerId] ?? 0);
}

export interface PlayerStats {
  outstanding: number;
  grade: CreditGrade;
  lateCount: number;
  cupsRedeemed: number;
  cleanStamps: number;
  received: number;
  overpaid: number;
}

export function playerStats(s: LedgerState, playerId: PlayerId): PlayerStats {
  const out = outstanding(s, playerId);
  const redemptions = s.redemptionOrder.flatMap((id) => {
    const r = s.redemptions[id];
    return r && !r.reverted ? [r] : [];
  });
  return {
    outstanding: out,
    grade: creditGrade(out),
    lateCount: lateRecordsOf(s, playerId).filter((r) => r.status === 'active').length,
    cupsRedeemed: redemptions.filter((r) => r.debtorId === playerId).reduce((n, r) => n + r.cupIds.length, 0),
    cleanStamps: redemptions.filter((r) => r.payerId === playerId && r.stampQuality === 'clean').length,
    received: s.towers[playerId]?.received.length ?? 0,
    overpaid: overpaid(s, playerId),
  };
}

/** Active players, most outstanding cups first; ties keep join order. */
export const ranking = (s: LedgerState): { player: Player; outstanding: number }[] =>
  activePlayers(s)
    .map((player) => ({ player, outstanding: outstanding(s, player.id) }))
    .sort((a, b) => b.outstanding - a.outstanding);

export const openProposal = (s: LedgerState, targetId: EventId, now: Instant): WaiveProposal | undefined => {
  const id = s.lates[targetId]?.openProposalId;
  const p = id ? s.proposals[id] : undefined;
  return p && proposalStatus(p, now) === 'open' ? p : undefined;
};

/** Proposals waiting for `voterId`'s ballot. */
export const ballotsFor = (s: LedgerState, voterId: PlayerId, now: Instant): WaiveProposal[] =>
  s.proposalOrder.flatMap((id) => {
    const p = s.proposals[id];
    return p && proposalStatus(p, now) === 'open' && p.voters.includes(voterId) && p.votes[voterId] === undefined
      ? [p]
      : [];
  });

export interface ArrivalPreview extends Judgement {
  scheduledStart: HHmm;
  graceMinutes: number;
  cups: number;
  /** An active record already exists for this player and date. */
  duplicateOf?: EventId;
}

/** What recording this arrival would do. The record form renders this so UI and domain never disagree. */
export function previewArrival(
  s: LedgerState,
  input: { playerId: PlayerId; workDate: WorkDate; arrivedAt: HHmm; scheduledStart?: HHmm },
): ArrivalPreview {
  const rs = rulesetAt(s, input.workDate);
  const scheduledStart =
    input.scheduledStart ?? s.players[input.playerId]?.startTimeOverride ?? rs.defaultStartTime;
  const judgement = judgeLateness(input.arrivedAt, scheduledStart, rs.graceMinutes);
  const duplicate = activeLateOn(s, input.playerId, input.workDate);
  return {
    ...judgement,
    scheduledStart,
    graceMinutes: rs.graceMinutes,
    cups: computeCups(judgement, rs.cupRule),
    ...(duplicate && { duplicateOf: duplicate.id }),
  };
}

export interface Streak {
  kind: 'late' | 'onTime' | 'none';
  /** Consecutive recorded work days of that kind, newest first. */
  count: number;
}

/**
 * Current streak from the most recent recorded days (DESIGN.md §2.3 상황 연출): late days come from active
 * late records, on-time days from ArrivalOnTime. A day with both counts as late. Days without any record
 * are skipped (weekends, leave) rather than breaking the streak.
 */
export function streak(s: LedgerState, playerId: PlayerId): Streak {
  const days = new Map<WorkDate, 'late' | 'onTime'>();
  for (const o of s.onTimes) if (o.playerId === playerId) days.set(o.workDate, 'onTime');
  for (const r of lateRecordsOf(s, playerId)) if (r.status === 'active') days.set(r.workDate, 'late');
  const ordered = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, k]) => k);
  const first = ordered[0];
  if (!first) return { kind: 'none', count: 0 };
  let count = 0;
  while (ordered[count] === first) count++;
  return { kind: first, count };
}

/** Redemptions where `playerId` received coffee and has not confirmed it yet. */
export const awaitingReceipt = (s: LedgerState, playerId: PlayerId): Redemption[] =>
  s.redemptionOrder.flatMap((id) => {
    const r = s.redemptions[id];
    return r && !r.reverted && r.cupIds.length > 0 && r.recipients.includes(playerId) && !r.acknowledgedBy.includes(playerId)
      ? [r]
      : [];
  });

/** Who gets which cup: round-robin over recipients; recipients beyond the cup count get nothing. */
export const distribute = <T>(cups: readonly T[], recipients: readonly PlayerId[]): { cup: T; to: PlayerId }[] =>
  recipients.length === 0 ? [] : cups.map((cup, i) => ({ cup, to: recipients[i % recipients.length]! }));

// ── modes, attendance & motions ─────────────────────────────────────────────

/** Attendance mode with the common rules confirmed: check-ins and missed days count from `startsOn`. */
export const attendanceInForce = (s: LedgerState): boolean => s.mode === 'attendance' && s.attendance.startsOn !== undefined;

export const attendanceOn = (s: LedgerState, playerId: PlayerId, date: WorkDate): 'checkIn' | 'missed' | undefined =>
  s.attendance.days[attendanceKey(playerId, date)];

/** Why a player cannot check in on a date, regardless of where they are. */
export type CheckInBlocker = 'wrongMode' | 'notAdopted' | 'notStarted' | 'checkedIn' | 'missed' | 'dayOff' | 'spectator';

/** What stops `playerId` from checking in on `date` apart from location, or null when nothing does. */
export function checkInBlocker(s: LedgerState, playerId: PlayerId, date: WorkDate): CheckInBlocker | null {
  if (s.mode !== 'attendance') return 'wrongMode';
  if (s.spectators[playerId]) return 'spectator';
  const { startsOn } = s.attendance;
  if (!startsOn) return 'notAdopted';
  if (date < startsOn) return 'notStarted';
  const settled = attendanceOn(s, playerId, date);
  if (settled === 'checkIn') return 'checkedIn';
  if (settled === 'missed') return 'missed';
  if (!isWorkdayFor(s, rulesetAt(s, date), playerId, date)) return 'dayOff';
  return null;
}

/** How far back a device settles missed days; older gaps are left alone. */
export const SETTLE_LOOKBACK_DAYS = 62;
const SETTLE_AFTER = '00:05';

/** Work days that ended without a check-in and are not settled yet, oldest first. */
export function missedDays(s: LedgerState, now: Instant): { playerId: PlayerId; workDate: WorkDate }[] {
  const { startsOn } = s.attendance;
  if (!attendanceInForce(s) || !startsOn) return [];
  const wall = wallTimeAt(now, currentRuleset(s).timezone);
  // A few minutes past midnight before settling yesterday: the server refuses days that are not over by its
  // clock, and a device clock running fast would otherwise send events it rejects.
  const last = wall.hhmm < SETTLE_AFTER ? addDays(wall.workDate, -1) : wall.workDate;
  const earliest = addDays(wall.workDate, -SETTLE_LOOKBACK_DAYS);
  const out: { playerId: PlayerId; workDate: WorkDate }[] = [];
  for (let date = startsOn > earliest ? startsOn : earliest; date < last; date = addDays(date, 1)) {
    const rs = rulesetAt(s, date);
    for (const p of activePlayers(s)) {
      if (!s.acted[p.id] || s.spectators[p.id]) continue;
      const joined = s.joinedOn[p.id];
      if (joined !== undefined && joined >= date) continue;
      if (attendanceOn(s, p.id, date) !== undefined) continue;
      if (isWorkdayFor(s, rs, p.id, date)) out.push({ playerId: p.id, workDate: date });
    }
  }
  return out;
}

/** On the sidelines: still in the ledger and still watching, but not judged, charged or asked to vote. */
export const isSpectator = (s: LedgerState, playerId: PlayerId | null | undefined): boolean => !!playerId && !!s.spectators[playerId];

export const motionsOpen = (s: LedgerState, now: Instant): MotionRecord[] =>
  s.motionOrder.flatMap((id) => {
    const m = s.motions[id];
    return m && motionStatus(m, now) === 'open' ? [m] : [];
  });

/** Motions waiting for `voterId`'s ballot. */
export const motionBallotsFor = (s: LedgerState, voterId: PlayerId, now: Instant): MotionRecord[] =>
  motionsOpen(s, now).filter((m) => m.voters.includes(voterId) && m.votes[voterId] === undefined);

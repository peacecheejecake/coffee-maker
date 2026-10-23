import { creditGrade, type CreditGrade } from './credit';
import type { EventId, PlayerId } from './ids';
import { computeCups, judgeLateness, type Judgement } from './judge';
import type { Player } from './player';
import { DEFAULT_RULESET, type Ruleset } from './ruleset';
import type { LateRecord, LedgerState, Redemption, WaiveProposal } from './state';
import type { HHmm, Instant, WorkDate } from './time';
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
  const redemptions = s.redemptionOrder.flatMap((id) => s.redemptions[id] ?? []);
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

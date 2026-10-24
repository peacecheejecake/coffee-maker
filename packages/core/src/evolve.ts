import { isWorkdayFor } from './calendar';
import { effectiveAt, type EventOf, type LedgerEvent, type Motion } from './events';
import type { EventId, PlayerId } from './ids';
import { computeCups, judgeLateness } from './judge';
import { tallyMotion } from './motion';
import type { Player } from './player';
import { motionIssue, motionVoters } from './motionRules';
import { RETRACT_WINDOW_MINUTES } from './policy';
import { isValidRuleset, maxCups } from './ruleset';
import { currentRuleset, rulesetAt } from './selectors';
import {
  attendanceKey,
  emptyState,
  type Cup,
  type LateRecord,
  type LateStatus,
  type LedgerState,
  type MotionRecord,
  type ReceivedCoffee,
  type Tower,
  type WaiveProposal,
} from './state';
import { addDays, addHours, isAfter, minutesBetween, wallTimeAt, type Instant, type WorkDate } from './time';
import { tallyWaive } from './waive';

/**
 * Applies one event. Pure and never throws: events that are invalid against the current state
 * (late votes, duplicate proposals, edits to closed records…) are ignored, so every device that
 * replays the same sequence converges on the same state even when commands raced.
 */
export function evolve(state: LedgerState, e: LedgerEvent): LedgerState {
  return apply(markActed(state, e), e);
}

/**
 * Any event a player issues themselves shows they use the app (see LedgerState.acted). Marked before the event
 * applies, so a first check-in counts; and like joining, the days before that are never charged.
 */
function markActed(s: LedgerState, e: LedgerEvent): LedgerState {
  const player = s.players[e.actorId];
  if (!player || s.acted[player.id]) return s;
  const at = effectiveAt(e);
  const today = localDate(s, at);
  const joined = s.joinedOn[player.id];
  return {
    ...s,
    acted: { ...s.acted, [player.id]: at },
    joinedOn: { ...s.joinedOn, [player.id]: joined !== undefined && joined > today ? joined : today },
  };
}

function apply(state: LedgerState, e: LedgerEvent): LedgerState {
  switch (e.type) {
    case 'PlayerJoined':
      return onPlayerJoined(state, e);
    case 'PlayerUpdated':
      return onPlayerUpdated(state, e);
    case 'RulesetChanged':
      return onRulesetChanged(state, e);
    case 'LateRecorded':
      return onLateRecorded(state, e);
    case 'LateCorrected':
      return onLateCorrected(state, e);
    case 'LateRetracted':
      return onLateRetracted(state, e);
    case 'ArrivalOnTime':
      return state.players[e.playerId]
        ? { ...state, onTimes: [...state.onTimes, { id: e.id, playerId: e.playerId, workDate: e.workDate, arrivedAt: e.arrivedAt }] }
        : state;
    case 'WaiveProposed':
      return onWaiveProposed(state, e);
    case 'WaiveVoted':
      return onWaiveVoted(state, e);
    case 'WaiveWithdrawn':
      return onWaiveWithdrawn(state, e);
    case 'CupsRedeemed':
      return onCupsRedeemed(state, e);
    case 'RedemptionAcknowledged':
      return onRedemptionAcknowledged(state, e);
    case 'RedemptionReverted':
      return onRedemptionReverted(state, e);
    case 'PlayerClaimed':
      return state;
    case 'ModeChanged':
      return onModeChanged(state, e);
    case 'OwnerTransferred':
      return onOwnerTransferred(state, e);
    case 'RulesAdopted':
      return onRulesAdopted(state, e);
    case 'CheckedIn':
      return onCheckedIn(state, e);
    case 'AttendanceMissed':
      return onAttendanceMissed(state, e);
    case 'HolidaySet':
      return state.mode === 'attendance' ? state : setHoliday(state, e.date, e.name, e.off, effectiveAt(e));
    case 'VacationSet':
      return onVacationSet(state, e);
    case 'MotionProposed':
      return onMotionProposed(state, e);
    case 'MotionVoted':
      return onMotionVoted(state, e);
    case 'MotionWithdrawn':
      return onMotionWithdrawn(state, e);
  }
}

export const project = (events: readonly LedgerEvent[], initial: LedgerState = emptyState()): LedgerState =>
  events.reduce(evolve, initial);

// ── players & rules ─────────────────────────────────────────────────────────

function onPlayerJoined(s: LedgerState, e: EventOf<'PlayerJoined'>): LedgerState {
  const { player } = e;
  if (s.players[player.id]) return s;
  return {
    ...s,
    players: { ...s.players, [player.id]: player },
    playerOrder: [...s.playerOrder, player.id],
    joinedOn: { ...s.joinedOn, [player.id]: localDate(s, effectiveAt(e)) },
    towers: { ...s.towers, [player.id]: { playerId: player.id, cups: [], received: [] } },
  };
}

function onPlayerUpdated(s: LedgerState, e: EventOf<'PlayerUpdated'>): LedgerState {
  const player = s.players[e.playerId];
  const actor = s.players[e.actorId];
  if (!player || !actor || actor.archived) return s;
  // Same authority as decide: members edit only themselves, only the owner archives.
  const owner = actor.role === 'owner';
  if ((player.id !== actor.id || e.patch.archived !== undefined) && !owner) return s;
  // Only the patchable fields; the role moves solely through OwnerTransferred.
  const { name, appearance, archived, startTimeOverride } = e.patch;
  const next: Player = {
    ...player,
    ...(typeof name === 'string' && { name }),
    ...(appearance !== undefined && { appearance }),
    ...(typeof archived === 'boolean' && { archived }),
  };
  if (startTimeOverride === null) delete next.startTimeOverride;
  else if (startTimeOverride !== undefined) next.startTimeOverride = startTimeOverride;
  const updated = { ...s, players: { ...s.players, [e.playerId]: next } };
  // Coming back from the archive counts like joining again: the days away are never charged.
  return player.archived && next.archived === false
    ? { ...updated, joinedOn: { ...updated.joinedOn, [player.id]: localDate(s, effectiveAt(e)) } }
    : updated;
}

function onRulesetChanged(s: LedgerState, e: EventOf<'RulesetChanged'>): LedgerState {
  // Adopted attendance rules change only through motions.
  if ((s.mode === 'attendance' && s.attendance.adoptedOn) || !isValidRuleset(e.ruleset)) return s;
  return putRuleset(s, e.effectiveFrom, e.ruleset);
}

function putRuleset(s: LedgerState, effectiveFrom: WorkDate, ruleset: LedgerState['rulesets'][number]['ruleset']): LedgerState {
  // Insert after every entry with the same or earlier date so the latest change for a date wins.
  const idx = s.rulesets.findIndex((r) => r.effectiveFrom > effectiveFrom);
  const entry = { effectiveFrom, ruleset };
  const rulesets = idx === -1 ? [...s.rulesets, entry] : [...s.rulesets.slice(0, idx), entry, ...s.rulesets.slice(idx)];
  return { ...s, rulesets };
}

/** From `date` on, `ruleset` is the only rule: entries planted for later dates are dropped. */
const replaceRulesetFrom = (s: LedgerState, date: WorkDate, ruleset: LedgerState['rulesets'][number]['ruleset']): LedgerState => ({
  ...s,
  rulesets: [...s.rulesets.filter((r) => r.effectiveFrom < date), { effectiveFrom: date, ruleset }],
});

// ── late records ────────────────────────────────────────────────────────────

function onLateRecorded(s: LedgerState, e: EventOf<'LateRecorded'>): LedgerState {
  if (!s.players[e.playerId] || s.lates[e.id] || e.cups < 1 || s.mode === 'attendance') return s;
  return issueRecord(s, {
    id: e.id,
    playerId: e.playerId,
    workDate: e.workDate,
    scheduledStart: e.scheduledStart,
    arrivedAt: e.arrivedAt,
    minutesLate: e.minutesLate,
    cups: e.cups,
    cupsOverridden: e.cupsOverridden,
    ...(e.note !== undefined && { note: e.note }),
    recordedBy: e.actorId,
    recordedAt: effectiveAt(e),
    status: 'active',
    issued: e.cups,
    redeemed: 0,
    corrections: [],
  });
}

/** Adds a new record and stacks its cups on the player's tower. */
function issueRecord(s: LedgerState, record: LateRecord): LedgerState {
  const tower = getTower(s, record.playerId);
  const next = putLate({ ...s, lateOrder: [...s.lateOrder, record.id] }, record);
  return putTower(next, {
    ...tower,
    cups: [...tower.cups, ...newCups(record.id, 1, record.cups, record.workDate)],
  });
}

function onLateCorrected(s: LedgerState, e: EventOf<'LateCorrected'>): LedgerState {
  const rec = s.lates[e.targetId];
  if (!rec || rec.status !== 'active' || e.resultingCups < 1 || s.mode === 'attendance') return s;

  // A record always shows max(0, claimed − redeemed) cups. Paid cups are never taken back;
  // if the claim drops below what was paid, the difference shows up as overpaid.
  let tower = getTower(s, rec.playerId);
  const alive = tower.cups.filter((c) => c.sourceId === rec.id).length;
  const delta = Math.max(0, e.resultingCups - rec.redeemed) - alive;
  if (delta > 0) {
    tower = { ...tower, cups: [...tower.cups, ...newCups(rec.id, rec.issued + 1, delta, rec.workDate)] };
  } else if (delta < 0) {
    tower = removeCupsOfSource(tower, rec.id, -delta);
  }

  const { changes } = e;
  const updated: LateRecord = {
    ...rec,
    scheduledStart: changes.scheduledStart ?? rec.scheduledStart,
    arrivedAt: changes.arrivedAt ?? rec.arrivedAt,
    minutesLate: e.resultingMinutesLate,
    cups: e.resultingCups,
    cupsOverridden: rec.cupsOverridden || changes.cups !== undefined,
    ...(changes.note !== undefined && { note: changes.note }),
    issued: rec.issued + Math.max(0, delta),
    corrections: [
      ...rec.corrections,
      {
        eventId: e.id,
        actorId: e.actorId,
        at: effectiveAt(e),
        changes,
        ...(e.reason !== undefined && { reason: e.reason }),
        before: {
          scheduledStart: rec.scheduledStart,
          arrivedAt: rec.arrivedAt,
          minutesLate: rec.minutesLate,
          cups: rec.cups,
          ...(rec.note !== undefined && { note: rec.note }),
        },
      },
    ],
  };
  return putTower(putLate(s, updated), tower);
}

function onLateRetracted(s: LedgerState, e: EventOf<'LateRetracted'>): LedgerState {
  const rec = s.lates[e.targetId];
  if (!rec || rec.status !== 'active' || rec.origin || rec.recordedBy !== e.actorId) return s;
  if (minutesBetween(rec.recordedAt, effectiveAt(e)) > RETRACT_WINDOW_MINUTES) return s;
  return closeRecord(s, rec, 'retracted', effectiveAt(e));
}

// ── waive proposals ─────────────────────────────────────────────────────────

function onWaiveProposed(s: LedgerState, e: EventOf<'WaiveProposed'>): LedgerState {
  const rec = s.lates[e.targetId];
  if (!rec || rec.status !== 'active' || s.proposals[e.id] || e.voters.length === 0) return s;
  const at = effectiveAt(e);

  let next = s;
  if (rec.openProposalId) {
    const existing = s.proposals[rec.openProposalId];
    if (existing && existing.status === 'open') {
      if (!isAfter(at, existing.expiresAt)) return s; // one open proposal per record
      next = putProposal(next, { ...existing, status: 'expired', closedAt: existing.expiresAt });
    }
  }

  const proposal: WaiveProposal = {
    id: e.id,
    targetId: e.targetId,
    debtorId: rec.playerId,
    proposerId: e.actorId,
    reason: e.reason,
    voters: e.voters,
    policy: e.policy,
    proposedAt: at,
    expiresAt: e.expiresAt,
    votes: {},
    status: 'open',
  };
  next = putProposal({ ...next, proposalOrder: [...next.proposalOrder, e.id] }, proposal);
  return putLate(next, { ...rec, openProposalId: e.id });
}

function onWaiveVoted(s: LedgerState, e: EventOf<'WaiveVoted'>): LedgerState {
  const p = s.proposals[e.proposalId];
  if (!p || p.status !== 'open') return s;
  const at = effectiveAt(e);

  if (isAfter(at, p.expiresAt)) return closeProposal(s, p, 'expired', p.expiresAt);
  if (!p.voters.includes(e.actorId) || p.votes[e.actorId] !== undefined) return s;

  const voted: WaiveProposal = { ...p, votes: { ...p.votes, [e.actorId]: e.vote } };
  switch (tallyWaive(voted.policy, voted.voters, voted.votes)) {
    case 'pending':
      return putProposal(s, voted);
    case 'rejected':
      return closeProposal(s, voted, 'rejected', at);
    case 'approved': {
      const next = closeProposal(s, voted, 'approved', at);
      const rec = next.lates[p.targetId];
      return rec && rec.status === 'active' ? closeRecord(next, rec, 'waived', at) : next;
    }
  }
}

function onWaiveWithdrawn(s: LedgerState, e: EventOf<'WaiveWithdrawn'>): LedgerState {
  const p = s.proposals[e.proposalId];
  if (!p || p.status !== 'open' || p.proposerId !== e.actorId) return s;
  return closeProposal(s, p, 'withdrawn', effectiveAt(e));
}

// ── redemptions ─────────────────────────────────────────────────────────────

function onCupsRedeemed(s: LedgerState, e: EventOf<'CupsRedeemed'>, viaMotion = false): LedgerState {
  if (s.redemptions[e.id] || !s.players[e.debtorId] || e.count < 1) return s;
  // In attendance mode cups are paid back one at a time through redeem motions.
  if (s.mode === 'attendance' && !viaMotion) return s;

  const tower = getTower(s, e.debtorId);
  const take = Math.min(e.count, tower.cups.length);
  const taken = e.order === 'newest' ? tower.cups.slice(tower.cups.length - take).reverse() : tower.cups.slice(0, take);
  const takenIds = new Set(taken.map((c) => c.id));

  let next = putTower(s, { ...tower, cups: tower.cups.filter((c) => !takenIds.has(c.id)) });

  for (const cup of taken) {
    const rec = next.lates[cup.sourceId];
    if (rec) next = putLate(next, { ...rec, redeemed: rec.redeemed + 1 });
  }

  const excess = e.count - take;
  if (excess > 0) {
    next = {
      ...next,
      unappliedRedeemed: { ...next.unappliedRedeemed, [e.debtorId]: (next.unappliedRedeemed[e.debtorId] ?? 0) + excess },
    };
  }

  // Hand the cups out round-robin; recipients beyond the cup count get nothing.
  const recipients = e.recipients.filter((r) => next.players[r]);
  if (recipients.length > 0) {
    taken.forEach((cup, i) => {
      const to = recipients[i % recipients.length] as PlayerId;
      const t = getTower(next, to);
      const gift: ReceivedCoffee = { cupId: cup.id, from: e.payerId, redemptionId: e.id };
      next = putTower(next, { ...t, received: [...t.received, gift] });
    });
  }

  return {
    ...next,
    redemptions: {
      ...next.redemptions,
      [e.id]: {
        id: e.id,
        debtorId: e.debtorId,
        payerId: e.payerId,
        recordedBy: e.actorId,
        at: effectiveAt(e),
        requested: e.count,
        cupIds: taken.map((c) => c.id),
        recipients: e.recipients,
        order: e.order,
        stampQuality: e.stampQuality,
        ...(e.evidence && { evidence: e.evidence }),
        acknowledgedBy: [],
        reverted: false,
        ...(viaMotion && { viaMotion: true as const }),
      },
    },
    redemptionOrder: [...next.redemptionOrder, e.id],
  };
}

function onRedemptionReverted(s: LedgerState, e: EventOf<'RedemptionReverted'>): LedgerState {
  const r = s.redemptions[e.redemptionId];
  if (!r || r.reverted || r.viaMotion || r.recordedBy !== e.actorId) return s;
  if (minutesBetween(r.at, effectiveAt(e)) > RETRACT_WINDOW_MINUTES) return s;

  // Undo the payment per record, then show max(0, claim − paid) cups again (same rule as corrections),
  // reusing the reverted cup ids so they return to their issue order.
  let next = s;
  const restored: Cup[] = [];
  const bySource = new Map<EventId, string[]>();
  for (const cupId of r.cupIds) {
    const sourceId = cupId.slice(0, cupId.lastIndexOf('#')) as EventId;
    bySource.set(sourceId, [...(bySource.get(sourceId) ?? []), cupId]);
  }
  for (const [sourceId, ids] of bySource) {
    const rec = next.lates[sourceId];
    if (!rec) continue;
    const updated = { ...rec, redeemed: Math.max(0, rec.redeemed - ids.length) };
    next = putLate(next, updated);
    if (updated.status !== 'active') continue;
    const alive = getTower(next, r.debtorId).cups.filter((c) => c.sourceId === sourceId).length;
    const missing = Math.max(0, updated.cups - updated.redeemed) - alive;
    for (const cupId of ids.slice(0, Math.max(0, missing))) restored.push({ id: cupId, sourceId, issuedOn: rec.workDate });
  }
  const tower = getTower(next, r.debtorId);
  const alive = new Set(tower.cups.map((c) => c.id));
  const rank = (c: Cup) => next.lateOrder.indexOf(c.sourceId) * 1000 + Number(c.id.slice(c.id.lastIndexOf('#') + 1));
  const cups = [...tower.cups, ...restored.filter((c) => !alive.has(c.id))].sort((a, b) => rank(a) - rank(b));
  next = putTower(next, { ...tower, cups });
  for (const id of next.playerOrder) {
    const t = getTower(next, id);
    if (t.received.some((g) => g.redemptionId === r.id)) {
      next = putTower(next, { ...t, received: t.received.filter((g) => g.redemptionId !== r.id) });
    }
  }
  return { ...next, redemptions: { ...next.redemptions, [r.id]: { ...r, reverted: true } } };
}

function onRedemptionAcknowledged(s: LedgerState, e: EventOf<'RedemptionAcknowledged'>): LedgerState {
  const r = s.redemptions[e.redemptionId];
  if (!r || r.reverted || !r.recipients.includes(e.actorId) || r.acknowledgedBy.includes(e.actorId)) return s;
  return {
    ...s,
    redemptions: { ...s.redemptions, [r.id]: { ...r, acknowledgedBy: [...r.acknowledgedBy, e.actorId] } },
  };
}

// ── modes & attendance ──────────────────────────────────────────────────────

const isOwner = (s: LedgerState, id: PlayerId) => {
  const p = s.players[id];
  return !!p && !p.archived && p.role === 'owner';
};

function onModeChanged(s: LedgerState, e: EventOf<'ModeChanged'>): LedgerState {
  // The very first mode of a group is set while bootstrapping, before anyone else exists.
  if (!isOwner(s, e.actorId) || s.mode === e.mode || (e.mode !== 'shared' && e.mode !== 'attendance')) return s;
  // Motions that only make sense in the old mode would otherwise pass and do nothing.
  let next: LedgerState = { ...s, mode: e.mode, attendance: { days: s.attendance.days } };
  for (const id of s.motionOrder) {
    const m = next.motions[id];
    if (m && m.status === 'open' && m.motion.kind !== 'adjust') {
      next = putMotion(next, { ...m, status: 'void', closedAt: effectiveAt(e) });
    }
  }
  return next;
}

function onOwnerTransferred(s: LedgerState, e: EventOf<'OwnerTransferred'>): LedgerState {
  const from = s.players[e.actorId];
  const to = s.players[e.to];
  // Not filtered on `to.archived`: the server has already moved the role, and both must agree.
  if (!from || !to || from.id === to.id || !isOwner(s, from.id)) return s;
  return {
    ...s,
    players: { ...s.players, [from.id]: { ...from, role: 'member' }, [to.id]: { ...to, role: 'owner' } },
  };
}

function onRulesAdopted(s: LedgerState, e: EventOf<'RulesAdopted'>): LedgerState {
  if (s.mode !== 'attendance' || s.attendance.adoptedOn || !isOwner(s, e.actorId) || !isValidRuleset(e.ruleset)) return s;
  const on = wallTimeAt(effectiveAt(e), e.ruleset.timezone).workDate;
  const next = replaceRulesetFrom(s, on, e.ruleset);
  return { ...next, attendance: { ...next.attendance, adoptedOn: on, startsOn: addDays(on, 1) } };
}

/** Whether attendance is being judged for `playerId` on `date`, before looking at the calendar. */
function judged(s: LedgerState, playerId: PlayerId, date: WorkDate): boolean {
  const { startsOn } = s.attendance;
  const player = s.players[playerId];
  const joined = s.joinedOn[playerId];
  return (
    s.mode === 'attendance' &&
    startsOn !== undefined &&
    date >= startsOn &&
    !!player &&
    !player.archived &&
    // Players nobody uses cannot check in; they are never charged.
    !!s.acted[playerId] &&
    // Joining mid-day never costs that day.
    (joined === undefined || joined < date) &&
    s.attendance.days[attendanceKey(playerId, date)] === undefined
  );
}

const markDay = (s: LedgerState, playerId: PlayerId, date: WorkDate, how: 'checkIn' | 'missed'): LedgerState => ({
  ...s,
  attendance: { ...s.attendance, days: { ...s.attendance.days, [attendanceKey(playerId, date)]: how } },
});

function onCheckedIn(s: LedgerState, e: EventOf<'CheckedIn'>): LedgerState {
  if (!judged(s, e.actorId, e.workDate)) return s;
  const rs = rulesetAt(s, e.workDate);
  const arrived = wallTimeAt(effectiveAt(e), rs.timezone);
  // A check-in counts for the day it actually happened on (server time once synced).
  if (arrived.workDate !== e.workDate) return s;
  const next = markDay(s, e.actorId, e.workDate, 'checkIn');
  if (!isWorkdayFor(next, rs, e.actorId, e.workDate)) return next;

  const scheduledStart = rs.defaultStartTime;
  const judgement = judgeLateness(arrived.hhmm, scheduledStart, rs.graceMinutes);
  const cups = computeCups(judgement, rs.cupRule);
  if (cups === 0) {
    return {
      ...next,
      onTimes: [...next.onTimes, { id: e.id, playerId: e.actorId, workDate: e.workDate, arrivedAt: arrived.hhmm }],
    };
  }
  return issueRecord(next, {
    id: e.id,
    playerId: e.actorId,
    workDate: e.workDate,
    scheduledStart,
    arrivedAt: arrived.hhmm,
    minutesLate: judgement.minutesLate,
    origin: 'checkIn',
    cups,
    cupsOverridden: false,
    recordedBy: e.actorId,
    recordedAt: effectiveAt(e),
    status: 'active',
    issued: cups,
    redeemed: 0,
    corrections: [],
  });
}

function onAttendanceMissed(s: LedgerState, e: EventOf<'AttendanceMissed'>): LedgerState {
  if (!s.players[e.actorId] || !judged(s, e.playerId, e.workDate)) return s;
  const rs = rulesetAt(s, e.workDate);
  // Only once the day is over in the group's timezone.
  if (wallTimeAt(effectiveAt(e), rs.timezone).workDate <= e.workDate) return s;
  if (!isWorkdayFor(s, rs, e.playerId, e.workDate)) return s;
  const cups = maxCups(rs.cupRule);
  return issueRecord(markDay(s, e.playerId, e.workDate, 'missed'), {
    id: e.id,
    playerId: e.playerId,
    workDate: e.workDate,
    scheduledStart: rs.defaultStartTime,
    arrivedAt: '',
    minutesLate: 0,
    origin: 'missed',
    cups,
    cupsOverridden: false,
    // Any device may settle the day and the server keeps whichever copy came first, so the settling
    // device must not leak into the state.
    recordedBy: e.playerId,
    recordedAt: effectiveAt(e),
    status: 'active',
    issued: cups,
    redeemed: 0,
    corrections: [],
  });
}

/** Closes attendance records of `playerIds` on `date` once that day turns out to be a day off. */
function excuse(s: LedgerState, playerIds: readonly PlayerId[], date: WorkDate, at: Instant): LedgerState {
  let next = s;
  for (const id of s.lateOrder) {
    const rec = next.lates[id];
    if (
      rec &&
      rec.status === 'active' &&
      rec.workDate === date &&
      (rec.origin === 'checkIn' || rec.origin === 'missed') &&
      playerIds.includes(rec.playerId)
    ) {
      next = closeRecord(next, rec, 'excused', at);
    }
  }
  return next;
}

function setHoliday(s: LedgerState, date: WorkDate, name: string, off: boolean, at: Instant): LedgerState {
  const next = { ...s, holidays: { ...s.holidays, [date]: { name, off } } };
  return off ? excuse(next, s.playerOrder, date, at) : next;
}

function onVacationSet(s: LedgerState, e: EventOf<'VacationSet'>): LedgerState {
  const player = s.players[e.actorId];
  if (!player || player.archived) return s;
  const dates = s.vacations[player.id] ?? [];
  const has = dates.includes(e.date);
  if (has === e.on) return s;
  const updated = e.on ? [...dates, e.date].sort() : dates.filter((d) => d !== e.date);
  const next = { ...s, vacations: { ...s.vacations, [player.id]: updated } };
  return e.on ? excuse(next, [player.id], e.date, effectiveAt(e)) : next;
}

// ── motions ─────────────────────────────────────────────────────────────────

function onMotionProposed(s: LedgerState, e: EventOf<'MotionProposed'>): LedgerState {
  const proposer = s.players[e.actorId];
  if (s.motions[e.id] || !proposer || proposer.archived) return s;
  if (e.motion?.kind !== 'adjust' && s.mode !== 'attendance') return s;
  // Never trust the payload: the server only checks ballots against this event's own voter list.
  if (motionIssue(s, e.motion) !== undefined) return s;
  const at = effectiveAt(e);
  if (!votersAcceptable(s, e, at)) return s;
  const ttl = currentRuleset(s).waivePolicy.ttlHours;
  // Client and server clocks may differ a little; a deadline far beyond the TTL is forged.
  if (!isAfter(e.expiresAt, at) || isAfter(e.expiresAt, addHours(at, ttl + EXPIRY_SLACK_HOURS))) return s;
  const motion: MotionRecord = {
    id: e.id,
    motion: e.motion,
    proposerId: e.actorId,
    voters: e.voters,
    proposedAt: at,
    expiresAt: e.expiresAt,
    votes: {},
    status: 'open',
  };
  const next = putMotion({ ...s, motionOrder: [...s.motionOrder, e.id] }, motion);
  // Nobody needs to agree (e.g. someone else's cup in a group of two): passes right away.
  return e.voters.length === 0 ? passMotion(next, motion, e) : next;
}

function onMotionVoted(s: LedgerState, e: EventOf<'MotionVoted'>): LedgerState {
  const m = s.motions[e.motionId];
  if (!m || m.status !== 'open') return s;
  const at = effectiveAt(e);
  if (isAfter(at, m.expiresAt)) return putMotion(s, { ...m, status: 'expired', closedAt: m.expiresAt });
  if (!m.voters.includes(e.actorId) || m.votes[e.actorId] !== undefined) return s;

  const voted: MotionRecord = { ...m, votes: { ...m.votes, [e.actorId]: e.vote } };
  switch (tallyMotion(voted.voters, voted.votes)) {
    case 'pending':
      return putMotion(s, voted);
    case 'rejected':
      return putMotion(s, { ...voted, status: 'rejected', closedAt: at });
    case 'approved':
      return passMotion(s, voted, e);
  }
}

function onMotionWithdrawn(s: LedgerState, e: EventOf<'MotionWithdrawn'>): LedgerState {
  const m = s.motions[e.motionId];
  if (!m || m.status !== 'open' || m.proposerId !== e.actorId) return s;
  return putMotion(s, { ...m, status: 'withdrawn', closedAt: effectiveAt(e) });
}

/** Closes a motion as approved and applies what it asked for, as of the deciding event. */
function passMotion(s: LedgerState, m: MotionRecord, decidedBy: LedgerEvent): LedgerState {
  const at = effectiveAt(decidedBy);
  const next = putMotion(s, { ...m, status: 'approved', closedAt: at });
  return applyMotion(next, m, m.motion, decidedBy);
}

function applyMotion(s: LedgerState, m: MotionRecord, motion: Motion, decidedBy: LedgerEvent): LedgerState {
  const at = effectiveAt(decidedBy);
  const today = localDate(s, at);
  switch (motion.kind) {
    case 'ruleset':
      return s.mode === 'attendance' ? replaceRulesetFrom(s, today, motion.ruleset) : s;
    case 'holiday':
      return s.mode === 'attendance' ? setHoliday(s, motion.date, motion.name, motion.off, at) : s;
    case 'adjust':
      return adjust(s, m, motion, today, at);
    case 'redeem': {
      if (s.mode !== 'attendance') return s;
      const { type: _, ...meta } = decidedBy;
      const paid: EventOf<'CupsRedeemed'> = {
        ...(meta as Omit<LedgerEvent, 'type'>),
        id: m.id,
        actorId: m.proposerId,
        type: 'CupsRedeemed',
        debtorId: motion.debtorId,
        payerId: motion.debtorId,
        count: 1,
        recipients: motion.recipients,
        order: 'oldest',
        stampQuality: motion.stampQuality,
        ...(motion.evidence && { evidence: motion.evidence }),
      };
      return onCupsRedeemed(s, paid, true);
    }
  }
}

function adjust(
  s: LedgerState,
  m: MotionRecord,
  motion: Extract<Motion, { kind: 'adjust' }>,
  today: WorkDate,
  at: Instant,
): LedgerState {
  const player = s.players[motion.playerId];
  if (!player || !Number.isInteger(motion.delta) || motion.delta === 0) return s;
  if (motion.delta > 0) {
    if (s.lates[m.id]) return s;
    return issueRecord(s, {
      id: m.id,
      playerId: player.id,
      workDate: today,
      scheduledStart: '',
      arrivedAt: '',
      minutesLate: 0,
      origin: 'adjustment',
      cups: motion.delta,
      cupsOverridden: true,
      note: motion.reason,
      recordedBy: m.proposerId,
      recordedAt: at,
      status: 'active',
      issued: motion.delta,
      redeemed: 0,
      corrections: [],
    });
  }
  // Removing cups: take them off the top and lower each source record's claim, so every record keeps
  // showing max(0, claim − paid) cups. A record left with no claim at all counts as waived.
  let next = s;
  const tower = getTower(s, player.id);
  const removed = tower.cups.slice(Math.max(0, tower.cups.length + motion.delta));
  next = putTower(next, { ...tower, cups: tower.cups.slice(0, tower.cups.length - removed.length) });
  for (const cup of removed) {
    const rec = next.lates[cup.sourceId];
    if (!rec) continue;
    const cups = rec.cups - 1;
    next = putLate(next, { ...rec, cups, cupsOverridden: true });
    if (cups === 0) next = closeRecord(next, { ...rec, cups }, 'waived', at);
  }
  return next;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const EXPIRY_SLACK_HOURS = 6;
/** How long a proposal may sit on a device (offline) before it reaches the server. */
const PROPOSAL_DELAY_MINUTES = 60;

/**
 * The voter list may lag behind membership by the time it took to reach the server: someone who started
 * using the app after the proposer's device built the list may be missing. Anyone else missing, or anyone
 * who must not vote (the proposer on their own cup, the adjusted player), means the event was forged.
 */
function votersAcceptable(s: LedgerState, e: EventOf<'MotionProposed'>, at: Instant): boolean {
  if (!Array.isArray(e.voters) || new Set(e.voters).size !== e.voters.length) return false;
  const delay = minutesBetween(e.at, at);
  if (!(delay >= -PROPOSAL_DELAY_MINUTES && delay <= PROPOSAL_DELAY_MINUTES)) return false;
  const allowed = motionVoters(s, e.actorId, e.motion, { includeInactive: true });
  const required = motionVoters(s, e.actorId, e.motion).filter((id) => !isAfter(s.acted[id]!, e.at));
  return e.voters.every((v) => allowed.includes(v)) && required.every((v) => e.voters.includes(v));
}

const localDate = (s: LedgerState, at: Instant): WorkDate => wallTimeAt(at, currentRuleset(s).timezone).workDate;
const putMotion = (s: LedgerState, m: MotionRecord): LedgerState => ({ ...s, motions: { ...s.motions, [m.id]: m } });

const getTower = (s: LedgerState, playerId: PlayerId): Tower =>
  s.towers[playerId] ?? { playerId, cups: [], received: [] };

const putTower = (s: LedgerState, t: Tower): LedgerState => ({ ...s, towers: { ...s.towers, [t.playerId]: t } });
const putLate = (s: LedgerState, r: LateRecord): LedgerState => ({ ...s, lates: { ...s.lates, [r.id]: r } });
const putProposal = (s: LedgerState, p: WaiveProposal): LedgerState => ({
  ...s,
  proposals: { ...s.proposals, [p.id]: p },
});

function newCups(sourceId: EventId, firstN: number, count: number, issuedOn: WorkDate): Cup[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${sourceId}#${firstN + i}`, sourceId, issuedOn }));
}

/** Removes up to `max` cups belonging to `sourceId`, starting from the top of the tower. */
function removeCupsOfSource(tower: Tower, sourceId: EventId, max: number): Tower {
  const remove = new Set<string>();
  for (let i = tower.cups.length - 1; i >= 0 && remove.size < max; i--) {
    const cup = tower.cups[i];
    if (cup && cup.sourceId === sourceId) remove.add(cup.id);
  }
  return { ...tower, cups: tower.cups.filter((c) => !remove.has(c.id)) };
}

function closeProposal(
  s: LedgerState,
  p: WaiveProposal,
  status: Exclude<WaiveProposal['status'], 'open'>,
  at: Instant,
): LedgerState {
  const next = putProposal(s, { ...p, status, closedAt: at });
  const rec = next.lates[p.targetId];
  if (!rec || rec.openProposalId !== p.id) return next;
  const { openProposalId: _, ...rest } = rec;
  return putLate(next, rest);
}

function closeRecord(s: LedgerState, rec: LateRecord, status: Exclude<LateStatus, 'active'>, at: Instant): LedgerState {
  let next = s;
  if (rec.openProposalId) {
    const p = next.proposals[rec.openProposalId];
    if (p && p.status === 'open') next = closeProposal(next, p, 'void', at);
  }
  const current = next.lates[rec.id] ?? rec;
  const tower = removeCupsOfSource(getTower(next, rec.playerId), rec.id, Number.POSITIVE_INFINITY);
  const { openProposalId: _, ...rest } = current;
  return putTower(putLate(next, { ...rest, status }), tower);
}

import { effectiveAt, type EventOf, type LedgerEvent } from './events';
import type { EventId, PlayerId } from './ids';
import type { Player } from './player';
import { RETRACT_WINDOW_MINUTES } from './policy';
import {
  emptyState,
  type Cup,
  type LateRecord,
  type LedgerState,
  type ReceivedCoffee,
  type Tower,
  type WaiveProposal,
} from './state';
import { isAfter, minutesBetween, type Instant, type WorkDate } from './time';
import { tallyWaive } from './waive';

/**
 * Applies one event. Pure and never throws: events that are invalid against the current state
 * (late votes, duplicate proposals, edits to closed records…) are ignored, so every device that
 * replays the same sequence converges on the same state even when commands raced.
 */
export function evolve(state: LedgerState, e: LedgerEvent): LedgerState {
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
    towers: { ...s.towers, [player.id]: { playerId: player.id, cups: [], received: [] } },
  };
}

function onPlayerUpdated(s: LedgerState, e: EventOf<'PlayerUpdated'>): LedgerState {
  const player = s.players[e.playerId];
  if (!player) return s;
  const { startTimeOverride, ...rest } = e.patch;
  const next: Player = { ...player, ...rest };
  if (startTimeOverride === null) delete next.startTimeOverride;
  else if (startTimeOverride !== undefined) next.startTimeOverride = startTimeOverride;
  return { ...s, players: { ...s.players, [e.playerId]: next } };
}

function onRulesetChanged(s: LedgerState, e: EventOf<'RulesetChanged'>): LedgerState {
  // Insert after every entry with the same or earlier date so the latest change for a date wins.
  const idx = s.rulesets.findIndex((r) => r.effectiveFrom > e.effectiveFrom);
  const entry = { effectiveFrom: e.effectiveFrom, ruleset: e.ruleset };
  const rulesets = idx === -1 ? [...s.rulesets, entry] : [...s.rulesets.slice(0, idx), entry, ...s.rulesets.slice(idx)];
  return { ...s, rulesets };
}

// ── late records ────────────────────────────────────────────────────────────

function onLateRecorded(s: LedgerState, e: EventOf<'LateRecorded'>): LedgerState {
  if (!s.players[e.playerId] || s.lates[e.id] || e.cups < 1) return s;
  const record: LateRecord = {
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
  };
  const tower = getTower(s, e.playerId);
  const next = putLate({ ...s, lateOrder: [...s.lateOrder, e.id] }, record);
  return putTower(next, { ...tower, cups: [...tower.cups, ...newCups(e.id, 1, e.cups, e.workDate)] });
}

function onLateCorrected(s: LedgerState, e: EventOf<'LateCorrected'>): LedgerState {
  const rec = s.lates[e.targetId];
  if (!rec || rec.status !== 'active' || e.resultingCups < 1) return s;

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
  if (!rec || rec.status !== 'active' || rec.recordedBy !== e.actorId) return s;
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

function onCupsRedeemed(s: LedgerState, e: EventOf<'CupsRedeemed'>): LedgerState {
  if (s.redemptions[e.id] || !s.players[e.debtorId] || e.count < 1) return s;

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
      },
    },
    redemptionOrder: [...next.redemptionOrder, e.id],
  };
}

function onRedemptionReverted(s: LedgerState, e: EventOf<'RedemptionReverted'>): LedgerState {
  const r = s.redemptions[e.redemptionId];
  if (!r || r.reverted || r.recordedBy !== e.actorId) return s;
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

// ── helpers ─────────────────────────────────────────────────────────────────

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

function closeRecord(s: LedgerState, rec: LateRecord, status: 'retracted' | 'waived', at: Instant): LedgerState {
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

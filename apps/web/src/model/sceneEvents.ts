import { activePlayers, creditGrade, type LedgerEvent, type LedgerState } from '@coffee/core';
import type { SceneEvent } from '@coffee/scene';

/**
 * What the scene should animate when the ledger goes from `before` to `after` because of `events`
 * (local or from sync). Diff-based: cups that appeared or disappeared drive the animations, and the
 * events only explain *why* (bill + drop vs evaporate vs gold). A re-projection that changes nothing
 * visible animates nothing.
 */
export function toSceneEvents(before: LedgerState, after: LedgerState, events: readonly LedgerEvent[]): SceneEvent[] {
  const out: SceneEvent[] = [];
  const key = events.map((e) => e.id).join(',');
  let n = 0;
  const id = () => `${key}#${n++}`;

  const approvedTargets = new Set(
    after.proposalOrder.flatMap((pid) => {
      const p = after.proposals[pid];
      const was = before.proposals[pid];
      return p && p.status === 'approved' && was?.status !== 'approved' ? [p.targetId] : [];
    }),
  );

  for (const player of activePlayers(after)) {
    const prevCups = before.towers[player.id]?.cups ?? [];
    const nextCups = after.towers[player.id]?.cups ?? [];
    const prevIds = new Set(prevCups.map((c) => c.id));
    const nextIds = new Set(nextCups.map((c) => c.id));
    const added = nextCups.filter((c) => !prevIds.has(c.id)).map((c) => c.id);
    const removed = prevCups.filter((c) => !nextIds.has(c.id));

    if (removed.length > 0) {
      const waived = removed.filter((c) => approvedTargets.has(c.sourceId)).map((c) => c.id);
      const other = removed.filter((c) => !approvedTargets.has(c.sourceId)).map((c) => c.id);
      if (waived.length) out.push({ id: id(), kind: 'cupsRemoved', towerId: player.id, cupIds: waived, style: 'gold' });
      if (other.length) out.push({ id: id(), kind: 'cupsRemoved', towerId: player.id, cupIds: other, style: 'evaporate' });
    }
    if (added.length > 0) out.push({ id: id(), kind: 'cupsAdded', towerId: player.id, cupIds: added });

    const from = creditGrade(prevCups.length);
    const to = creditGrade(nextCups.length);
    if (from !== to && before.players[player.id]) out.push({ id: id(), kind: 'gradeChanged', towerId: player.id, from, to });
  }

  for (const pid of after.proposalOrder) {
    const p = after.proposals[pid];
    const was = before.proposals[pid];
    if (p?.status === 'rejected' && was && was.status === 'open') {
      out.push({ id: id(), kind: 'verdict', towerId: p.debtorId, outcome: 'rejected' });
    }
  }

  for (const e of events) {
    if (e.type === 'ArrivalOnTime' && after.players[e.playerId]) out.push({ id: id(), kind: 'onTime', towerId: e.playerId });
    if (e.type === 'RulesetChanged' && before.playerOrder.length > 0) out.push({ id: id(), kind: 'rulesChanged' });
  }
  return out;
}

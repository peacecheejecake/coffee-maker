import { activePlayers, creditGrade, distribute, type LedgerEvent, type LedgerState, type Redemption } from '@coffee/core';
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

  // New (not reverted) redemptions: which cup goes to whom, and whose debt they paid.
  const newRedemptions = after.redemptionOrder.flatMap((rid) => {
    const r = after.redemptions[rid];
    return r && !r.reverted && !before.redemptions[rid] ? [r] : [];
  });
  const destination = new Map<string, string>();
  for (const r of newRedemptions) {
    for (const { cup, to } of distribute(r.cupIds, r.recipients)) destination.set(cup, to);
  }
  const redeemedFor = (debtorId: string): Redemption | undefined => newRedemptions.find((r) => r.debtorId === debtorId);

  for (const player of activePlayers(after)) {
    const prevCups = before.towers[player.id]?.cups ?? [];
    const nextCups = after.towers[player.id]?.cups ?? [];
    const prevIds = new Set(prevCups.map((c) => c.id));
    const nextIds = new Set(nextCups.map((c) => c.id));
    const added = nextCups.filter((c) => !prevIds.has(c.id)).map((c) => c.id);
    const removed = prevCups.filter((c) => !nextIds.has(c.id));

    const redemption = redeemedFor(player.id);
    if (redemption?.evidence) out.push({ id: id(), kind: 'inspect', towerId: player.id });
    if (removed.length > 0) {
      const redeemed = removed.filter((c) => destination.has(c.id)).map((c) => c.id);
      const waived = removed.filter((c) => !destination.has(c.id) && approvedTargets.has(c.sourceId)).map((c) => c.id);
      const other = removed.filter((c) => !destination.has(c.id) && !approvedTargets.has(c.sourceId)).map((c) => c.id);
      if (redeemed.length) {
        const to = Object.fromEntries(redeemed.map((cupId) => [cupId, destination.get(cupId)!]));
        out.push({ id: id(), kind: 'cupsRemoved', towerId: player.id, cupIds: redeemed, style: 'ascend', to });
      }
      if (waived.length) out.push({ id: id(), kind: 'cupsRemoved', towerId: player.id, cupIds: waived, style: 'gold' });
      if (other.length) out.push({ id: id(), kind: 'cupsRemoved', towerId: player.id, cupIds: other, style: 'evaporate' });
    }
    if (added.length > 0) out.push({ id: id(), kind: 'cupsAdded', towerId: player.id, cupIds: added });

    const from = creditGrade(prevCups.length);
    const to = creditGrade(nextCups.length);
    if (from !== to && before.players[player.id]) out.push({ id: id(), kind: 'gradeChanged', towerId: player.id, from, to });
    if (redemption && prevCups.length > 0 && nextCups.length === 0) out.push({ id: id(), kind: 'paidOff', towerId: player.id });
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
    if (e.type === 'RedemptionAcknowledged') out.push({ id: id(), kind: 'acknowledged', towerId: e.actorId });
  }
  return out;
}

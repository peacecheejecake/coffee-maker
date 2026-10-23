import {
  activePlayers,
  creditGrade,
  cupAge,
  outstanding,
  type EventId,
  type LedgerState,
  type PlayerId,
  type WorkDate,
} from '@coffee/core';
import type { SceneModel } from '@coffee/scene';

/** Maps ledger state to what the 3D scene draws. The scene never sees domain types. */
export function toSceneModel(state: LedgerState, today: WorkDate, focusId: string | null = null): SceneModel {
  const players = activePlayers(state);
  const top = Math.max(0, ...players.map((p) => outstanding(state, p.id)));
  const open = state.proposalOrder.flatMap((id) => {
    const p = state.proposals[id];
    return p && p.status === 'open' ? [p] : [];
  });
  // A player's ballot on the most recent open proposal they voted on.
  const ballotOf = (id: PlayerId) => [...open].reverse().find((p) => p.votes[id] !== undefined)?.votes[id] ?? null;
  const underReview = (sourceId: EventId) => {
    const pid = state.lates[sourceId]?.openProposalId;
    return !!pid && state.proposals[pid]?.status === 'open';
  };
  return {
    focusId: focusId && players.some((p) => p.id === focusId) ? focusId : null,
    towers: players.map((p) => {
      const tower = state.towers[p.id];
      const cups = tower?.cups ?? [];
      return {
        id: p.id,
        name: p.name,
        color: p.appearance.color,
        ...(p.appearance.emoji !== undefined && { emoji: p.appearance.emoji }),
        grade: creditGrade(cups.length),
        cups: cups.map((c) => ({
          id: c.id,
          age: cupAge(c.issuedOn, today),
          ...(underReview(c.sourceId) && { underReview: true }),
        })),
        receivedCount: tower?.received.length ?? 0,
        crowned: top > 0 && cups.length === top,
        ballot: ballotOf(p.id),
      };
    }),
  };
}

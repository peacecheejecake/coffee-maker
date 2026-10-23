import {
  asGroupId,
  asPlayerId,
  decide,
  emptyState,
  evolve,
  type Command,
  type LedgerState,
  type PlayerId,
} from '@coffee/core';

/** Sleeve colors, distinguishable on the dark stage. */
export const PLAYER_COLORS = [
  '#e57373',
  '#64b5f6',
  '#81c784',
  '#ffb74d',
  '#ba68c8',
  '#4dd0e1',
  '#f06292',
  '#aed581',
  '#ffd54f',
  '#90a4ae',
];

const DEMO: { name: string; lates: { date: string; cups: number }[] }[] = [
  { name: '지원', lates: [] },
  { name: '민수', lates: [{ date: '2026-10-02', cups: 4 }, { date: '2026-10-20', cups: 3 }] },
  { name: '하나', lates: [{ date: '2026-10-22', cups: 3 }] },
  { name: '준호', lates: [{ date: '2026-08-01', cups: 6 }, { date: '2026-10-21', cups: 6 }] },
  { name: '서연', lates: [{ date: '2026-10-23', cups: 1 }] },
  {
    name: '태민',
    lates: [
      { date: '2026-06-01', cups: 10 },
      { date: '2026-09-01', cups: 10 },
      { date: '2026-10-01', cups: 10 },
      { date: '2026-10-23', cups: 4 },
    ],
  },
];

/** A small ledger built through the real domain commands, for the M1 home screen. */
export function createDemoLedger(today: string): LedgerState {
  let state = emptyState();
  let seq = 0;
  const owner = asPlayerId('p1');
  const run = (actorId: PlayerId, cmd: Command) => {
    const d = decide(state, cmd, {
      groupId: asGroupId('demo'),
      actorId,
      now: `${today}T00:30:00.000Z`,
      today,
      newId: () => `demo-${++seq}`,
    });
    if (!d.ok) throw new Error(`demo ledger: ${d.error.code} ${d.error.message}`);
    state = d.value.reduce(evolve, state);
  };

  DEMO.forEach((p, i) => {
    run(owner, {
      type: 'AddPlayer',
      id: asPlayerId(`p${i + 1}`),
      name: p.name,
      appearance: { color: PLAYER_COLORS[i % PLAYER_COLORS.length]! },
    });
  });
  DEMO.forEach((p, i) => {
    for (const late of p.lates) {
      run(owner, {
        type: 'RecordArrival',
        playerId: asPlayerId(`p${i + 1}`),
        workDate: late.date,
        arrivedAt: '09:20',
        cupsOverride: late.cups,
        allowDuplicate: true,
      });
    }
  });
  return state;
}

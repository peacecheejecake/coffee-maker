import {
  asGroupId,
  asPlayerId,
  decide,
  DEFAULT_RULESET,
  emptyState,
  evolve,
  type Command,
  type GroupId,
  type LedgerEvent,
  type PlayerId,
} from '@coffee/core';
import { PALETTE_CHOICES } from '@coffee/ui';

export const PLAYER_COLORS = PALETTE_CHOICES;

/** Each late is `daysAgo` days before today. */
const DEMO: { name: string; lates: { daysAgo: number; cups: number }[] }[] = [
  { name: '지원', lates: [] },
  { name: '민수', lates: [{ daysAgo: 21, cups: 4 }, { daysAgo: 3, cups: 3 }] },
  { name: '하나', lates: [{ daysAgo: 1, cups: 3 }] },
  { name: '준호', lates: [{ daysAgo: 83, cups: 6 }, { daysAgo: 2, cups: 6 }] },
  { name: '서연', lates: [{ daysAgo: 0, cups: 1 }] },
  {
    name: '태민',
    lates: [
      { daysAgo: 144, cups: 10 },
      { daysAgo: 52, cups: 10 },
      { daysAgo: 22, cups: 10 },
      { daysAgo: 0, cups: 4 },
    ],
  },
];

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

export interface DemoLedger {
  groupId: GroupId;
  me: PlayerId;
  events: LedgerEvent[];
}

/** A small ledger built through the real domain commands. Ids are prefixed so it never collides with real data. */
export function createDemoLedger(today: string, nowIso = `${today}T00:30:00.000Z`): DemoLedger {
  const groupId = asGroupId(`demo-${today}`);
  let state = emptyState();
  const events: LedgerEvent[] = [];
  let seq = 0;
  const owner = asPlayerId('demo-p1');
  const run = (cmd: Command) => {
    const d = decide(state, cmd, { groupId, actorId: owner, now: nowIso, today: shiftDate(today, 200), newId: () => `demo-${++seq}` });
    if (!d.ok) throw new Error(`demo ledger: ${d.error.code} ${d.error.message}`);
    events.push(...d.value);
    state = d.value.reduce(evolve, state);
  };

  DEMO.forEach((p, i) =>
    run({ type: 'AddPlayer', id: asPlayerId(`demo-p${i + 1}`), name: p.name, appearance: { color: PLAYER_COLORS[i % PLAYER_COLORS.length]! } }),
  );
  run({ type: 'ChangeRuleset', ruleset: DEFAULT_RULESET });
  DEMO.forEach((p, i) => {
    for (const late of p.lates) {
      run({
        type: 'RecordArrival',
        playerId: asPlayerId(`demo-p${i + 1}`),
        workDate: shiftDate(today, late.daysAgo),
        arrivedAt: '09:20',
        cupsOverride: late.cups,
        allowDuplicate: true,
      });
    }
  });
  return { groupId, me: owner, events };
}

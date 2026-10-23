import { asGroupId, asPlayerId, decide, emptyState, evolve, type Command, type LedgerEvent, type LedgerState } from '@coffee/core';
import { describe, expect, it } from 'vitest';
import { toSceneEvents } from '../src/model/sceneEvents';
import { toSceneModel } from '../src/model/toSceneModel';

const A = asPlayerId('A');
const B = asPlayerId('B');
const C = asPlayerId('C');

/** Small harness: apply commands and capture (before, after, events) per step. */
function ledger() {
  let state: LedgerState = emptyState();
  let seq = 0;
  const run = (actorId: typeof A, cmd: Command) => {
    const d = decide(state, cmd, { groupId: asGroupId('g'), actorId, now: '2026-10-23T00:30:00.000Z', today: '2026-10-23', newId: () => `e${++seq}` });
    if (!d.ok) throw new Error(d.error.code);
    const before = state;
    state = d.value.reduce(evolve, state);
    return { before, after: state, events: d.value as LedgerEvent[] };
  };
  for (const id of [A, B, C]) run(A, { type: 'AddPlayer', id, name: id, appearance: { color: '#000' } });
  return { run, get state() { return state; } };
}

const kinds = (xs: { kind: string }[]) => xs.map((x) => x.kind);

describe('toSceneEvents', () => {
  it('a late record adds cups (and may flip the grade)', () => {
    const l = ledger();
    const step = l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:30', cupsOverride: 3 });
    const out = toSceneEvents(step.before, step.after, step.events);
    expect(out).toEqual([
      { id: expect.any(String), kind: 'cupsAdded', towerId: B, cupIds: [`${step.events[0]!.id}#1`, `${step.events[0]!.id}#2`, `${step.events[0]!.id}#3`] },
      { id: expect.any(String), kind: 'gradeChanged', towerId: B, from: 'AAA', to: 'B' },
    ]);
  });

  it('retraction evaporates; an approved waiver turns gold; a rejection gets a verdict', () => {
    const l = ledger();
    const rec = l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:30' });
    const targetId = rec.events[0]!.id;
    const retract = l.run(A, { type: 'RetractLate', targetId });
    expect(toSceneEvents(retract.before, retract.after, retract.events)[0]).toMatchObject({ kind: 'cupsRemoved', style: 'evaporate' });

    const rec2 = l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:40', allowDuplicate: true });
    const prop = l.run(A, { type: 'ProposeWaive', targetId: rec2.events[0]!.id, reason: 'x' });
    const approve = l.run(C, { type: 'VoteWaive', proposalId: prop.events[0]!.id, vote: 'approve' });
    expect(kinds(toSceneEvents(approve.before, approve.after, approve.events))).toEqual(['cupsRemoved', 'gradeChanged']);
    expect(toSceneEvents(approve.before, approve.after, approve.events)[0]).toMatchObject({ style: 'gold' });

    const rec3 = l.run(A, { type: 'RecordArrival', playerId: C, arrivedAt: '09:40' });
    const prop3 = l.run(A, { type: 'ProposeWaive', targetId: rec3.events[0]!.id, reason: 'x' });
    const reject = l.run(B, { type: 'VoteWaive', proposalId: prop3.events[0]!.id, vote: 'reject' });
    expect(toSceneEvents(reject.before, reject.after, reject.events)).toEqual([
      { id: expect.any(String), kind: 'verdict', towerId: C, outcome: 'rejected' },
    ]);
  });

  it('on-time arrivals and rule changes', () => {
    const l = ledger();
    const ok = l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '08:55' });
    expect(kinds(toSceneEvents(ok.before, ok.after, ok.events))).toEqual(['onTime']);
    const rules = l.run(A, { type: 'ChangeRuleset', ruleset: { ...l.state.rulesets[0]?.ruleset, defaultStartTime: '09:00', graceMinutes: 5, cupRule: { mode: 'fixed', cups: 1 }, requireReceipt: true, waivePolicy: { mode: 'unanimous', ttlHours: 72 }, timezone: 'Asia/Seoul' } });
    expect(kinds(toSceneEvents(rules.before, rules.after, rules.events))).toEqual(['rulesChanged']);
  });

  it('a no-op reprojection animates nothing', () => {
    const l = ledger();
    l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:30' });
    expect(toSceneEvents(l.state, l.state, [])).toEqual([]);
  });
});

describe('toSceneModel review state', () => {
  it('marks cups under review and shows ballots', () => {
    const l = ledger();
    const rec = l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:30' });
    l.run(A, { type: 'ProposeWaive', targetId: rec.events[0]!.id, reason: 'x' });
    const m = toSceneModel(l.state, '2026-10-23');
    const b = m.towers.find((t) => t.id === B)!;
    expect(b.cups[0]!.underReview).toBe(true);
    expect(m.towers.find((t) => t.id === A)!.ballot).toBe('approve');
    expect(m.towers.find((t) => t.id === C)!.ballot).toBeNull();
  });
});

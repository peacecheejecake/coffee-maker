import { describe, expect, it } from 'vitest';
import { asEventId, DEFAULT_RULESET, previewArrival, RETRACT_WINDOW_MINUTES, streak } from '../src';
import { A, B, C, createLedger } from './harness';

const TIERED = {
  ...DEFAULT_RULESET,
  cupRule: {
    mode: 'tiered' as const,
    tiers: [
      { upToMinutes: 15, cups: 1 },
      { upToMinutes: 60, cups: 2 },
      { upToMinutes: null, cups: 3 },
    ],
  },
};

describe('recording arrivals', () => {
  it('on time (within grace) records an ArrivalOnTime, no cups', () => {
    const l = createLedger();
    l.join(A, B);
    const [e] = l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:01' });
    expect(e).toMatchObject({ type: 'ArrivalOnTime', playerId: B, workDate: '2026-10-23', minutesLate: 1 });
    expect(l.cups(B)).toBe(0);
    expect(l.state.onTimes).toHaveLength(1);
  });

  it('late records one cup by default, stored with its computed numbers', () => {
    const l = createLedger();
    l.join(A, B);
    const [e] = l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:07', note: '  버스  ' });
    expect(e).toMatchObject({
      type: 'LateRecorded',
      workDate: '2026-10-23',
      scheduledStart: '09:00',
      minutesLate: 7,
      cups: 1,
      cupsOverridden: false,
      note: '버스',
    });
    expect(l.state.towers[B]?.cups).toEqual([{ id: `${e?.id}#1`, sourceId: e?.id, issuedOn: '2026-10-23' }]);
  });

  it('uses the player start-time override, then an explicit scheduled start', () => {
    const l = createLedger();
    l.join(A, B);
    l.run(B, { type: 'UpdatePlayer', playerId: B, patch: { startTimeOverride: '10:00' } });
    expect(l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:30' })[0]?.type).toBe('ArrivalOnTime');
    const [e] = l.run(A, {
      type: 'RecordArrival',
      playerId: B,
      workDate: '2026-10-22',
      arrivedAt: '09:30',
      scheduledStart: '09:00',
    });
    expect(e).toMatchObject({ minutesLate: 30, scheduledStart: '09:00' });
  });

  it('manual cup override charges even when on time', () => {
    const l = createLedger();
    l.join(A, B);
    const [e] = l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '08:55', cupsOverride: 2 });
    expect(e).toMatchObject({ cups: 2, cupsOverridden: true, minutesLate: 0 });
    expect(l.cups(B)).toBe(2);
  });

  it('applies tiered rules', () => {
    const l = createLedger();
    l.join(A, B);
    l.run(A, { type: 'ChangeRuleset', ruleset: TIERED });
    l.late(B, '09:45');
    expect(l.cups(B)).toBe(2);
  });

  it('validates input', () => {
    const l = createLedger();
    l.join(A, B);
    const base = { type: 'RecordArrival' as const, playerId: B, arrivedAt: '09:30' };
    expect(l.fail(A, { ...base, playerId: C }).code).toBe('PlayerNotFound');
    expect(l.fail(A, { ...base, workDate: '2026-13-01' }).code).toBe('InvalidInput');
    expect(l.fail(A, { ...base, arrivedAt: '9:30' }).code).toBe('InvalidInput');
    expect(l.fail(A, { ...base, scheduledStart: 'x' }).code).toBe('InvalidInput');
    expect(l.fail(A, { ...base, cupsOverride: 0 }).code).toBe('InvalidInput');
    expect(l.fail(A, { ...base, cupsOverride: 1.5 }).code).toBe('InvalidInput');
  });

  it('warns on a duplicate date unless forced', () => {
    const l = createLedger();
    l.join(A, B);
    const first = l.late(B);
    const dup = l.fail(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:20' });
    expect(dup).toMatchObject({ code: 'DuplicateWorkDate', detail: { existingId: first } });
    l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:20', allowDuplicate: true });
    expect(l.cups(B)).toBe(2);
    expect(previewArrival(l.state, { playerId: B, workDate: '2026-10-22', arrivedAt: '09:20' }).duplicateOf).toBe(
      undefined,
    );
  });

  it('ignores records for unknown players or duplicate ids during replay', () => {
    const l = createLedger();
    l.join(A, B);
    const [e] = l.decideOnly(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:30' });
    l.apply(e!, e!);
    l.apply({ ...e!, id: asEventId('ghost'), playerId: C } as typeof e & object);
    expect(l.cups(B)).toBe(1);
    expect(l.state.lateOrder).toEqual([e!.id]);
  });
});

describe('scenario 1 — corrections', () => {
  it('increase, decrease, and refuse to reach zero', () => {
    const l = createLedger();
    l.join(A, B);
    const id = l.late(B, '09:10');

    l.run(A, { type: 'CorrectLate', targetId: id, changes: { cups: 3 }, reason: '  재판정 ' });
    expect(l.cups(B)).toBe(3);
    expect(l.state.towers[B]?.cups.map((c) => c.id)).toEqual([`${id}#1`, `${id}#2`, `${id}#3`]);

    l.run(B, { type: 'CorrectLate', targetId: id, changes: { cups: 1 } });
    expect(l.cups(B)).toBe(1);
    expect(l.state.towers[B]?.cups.map((c) => c.id)).toEqual([`${id}#1`]); // removed from the top

    const zero = l.fail(A, { type: 'CorrectLate', targetId: id, changes: { cups: 0 } });
    expect(zero.code).toBe('CorrectionToZero');

    const rec = l.state.lates[id];
    expect(rec?.cupsOverridden).toBe(true);
    expect(rec?.corrections).toHaveLength(2);
    expect(rec?.corrections[0]).toMatchObject({ actorId: A, reason: '재판정', before: { cups: 1 }, changes: { cups: 3 } });
  });

  it('recomputes cups from corrected times unless cups were overridden', () => {
    const l = createLedger();
    l.join(A, B);
    l.run(A, { type: 'ChangeRuleset', ruleset: TIERED });
    const id = l.late(B, '09:10');
    l.run(A, { type: 'CorrectLate', targetId: id, changes: { arrivedAt: '09:40', note: '확인함' } });
    expect(l.state.lates[id]).toMatchObject({ minutesLate: 40, cups: 2, note: '확인함' });
    expect(l.cups(B)).toBe(2);

    l.run(A, { type: 'CorrectLate', targetId: id, changes: { cups: 1 } });
    l.run(A, { type: 'CorrectLate', targetId: id, changes: { arrivedAt: '10:30' } });
    expect(l.state.lates[id]).toMatchObject({ minutesLate: 90, cups: 1 }); // override sticks
  });

  it('a correction that makes the arrival on time must go to a vote', () => {
    const l = createLedger();
    l.join(A, B);
    const id = l.late(B, '09:10');
    const e = l.fail(A, { type: 'CorrectLate', targetId: id, changes: { arrivedAt: '09:00' } });
    expect(e).toMatchObject({ code: 'CorrectionToZero', detail: { minutesLate: 0 } });
  });

  it('rejects no-op, invalid, and closed-record corrections', () => {
    const l = createLedger();
    l.join(A, B);
    const id = l.late(B, '09:10');
    expect(l.fail(A, { type: 'CorrectLate', targetId: id, changes: { arrivedAt: '09:10', cups: 1 } }).code).toBe(
      'NoChange',
    );
    expect(l.fail(A, { type: 'CorrectLate', targetId: id, changes: { arrivedAt: 'x' } }).code).toBe('InvalidInput');
    expect(l.fail(A, { type: 'CorrectLate', targetId: id, changes: { scheduledStart: 'x' } }).code).toBe(
      'InvalidInput',
    );
    expect(l.fail(A, { type: 'CorrectLate', targetId: id, changes: { cups: 11 } }).code).toBe('InvalidInput');
    expect(l.fail(A, { type: 'CorrectLate', targetId: asEventId('nope'), changes: { cups: 2 } }).code).toBe(
      'TargetNotFound',
    );
    l.run(A, { type: 'RetractLate', targetId: id });
    expect(l.fail(A, { type: 'CorrectLate', targetId: id, changes: { cups: 2 } }).code).toBe('AlreadyClosed');
  });

  it('can change the scheduled start', () => {
    const l = createLedger();
    l.join(A, B);
    const id = l.late(B, '10:10');
    l.run(A, { type: 'CorrectLate', targetId: id, changes: { scheduledStart: '10:00' } });
    expect(l.state.lates[id]).toMatchObject({ scheduledStart: '10:00', minutesLate: 10, cups: 1 });
  });
});

describe('scenario 4 — rule changes are not retroactive', () => {
  it('corrections use the ruleset of the record date', () => {
    const l = createLedger();
    l.join(A, B);
    l.setToday('2026-10-01');
    l.run(A, { type: 'ChangeRuleset', ruleset: DEFAULT_RULESET });
    const old = l.late(B, '09:10', { workDate: '2026-10-05' });

    l.setToday('2026-10-20');
    l.run(A, { type: 'ChangeRuleset', ruleset: { ...TIERED, graceMinutes: 30 } });

    // Old record keeps its cup and is re-judged with the old (fixed, grace 1) rules.
    expect(l.cups(B)).toBe(1);
    l.run(A, { type: 'CorrectLate', targetId: old, changes: { arrivedAt: '09:25' } });
    expect(l.state.lates[old]).toMatchObject({ minutesLate: 25, cups: 1 });

    // A new back-dated entry before the change also uses the old rules…
    l.late(B, '09:20', { workDate: '2026-10-10' });
    expect(l.cups(B)).toBe(2);
    // …while today's 20-minute lateness is within the new 30-minute grace.
    expect(l.run(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:20' })[0]?.type).toBe('ArrivalOnTime');
  });
});

describe('scenario 7 — retraction', () => {
  it('recorder can retract within the window', () => {
    const l = createLedger();
    l.join(A, B, C);
    const id = l.late(B, '09:10', { by: C });
    l.advanceMinutes(RETRACT_WINDOW_MINUTES);
    expect(l.fail(A, { type: 'RetractLate', targetId: id }).code).toBe('NotPermitted');
    l.run(C, { type: 'RetractLate', targetId: id });
    expect(l.cups(B)).toBe(0);
    expect(l.state.lates[id]?.status).toBe('retracted');
    expect(l.fail(C, { type: 'RetractLate', targetId: id }).code).toBe('AlreadyClosed');
    expect(l.fail(C, { type: 'RetractLate', targetId: asEventId('x') }).code).toBe('TargetNotFound');
  });

  it('closes after the window', () => {
    const l = createLedger();
    l.join(A, B);
    const id = l.late(B);
    l.advanceMinutes(RETRACT_WINDOW_MINUTES + 1);
    expect(l.fail(A, { type: 'RetractLate', targetId: id }).code).toBe('RetractWindowClosed');
  });

  it('evolve also enforces the window using server time', () => {
    const l = createLedger();
    l.join(A, B);
    const [rec] = l.decideOnly(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:10' });
    l.apply({ ...rec!, serverAt: '2026-10-23T00:00:00.000Z' });
    const [retract] = l.decideOnly(A, { type: 'RetractLate', targetId: rec!.id });
    // The client thought it was in time, but the server received it 11 minutes later.
    l.apply({ ...retract!, serverAt: '2026-10-23T00:11:00.000Z' });
    expect(l.cups(B)).toBe(1);
    // A retraction from someone else is ignored too.
    l.apply({ ...retract!, actorId: B });
    expect(l.state.lates[rec!.id]?.status).toBe('active');
  });
});

describe('streaks', () => {
  it('counts the latest run of late or on-time days, late winning a day with both', () => {
    const l = createLedger();
    l.join(A, B);
    expect(streak(l.state, B)).toEqual({ kind: 'none', count: 0 });
    for (const d of ['2026-10-19', '2026-10-20']) l.run(A, { type: 'RecordArrival', playerId: B, workDate: d, arrivedAt: '09:00' });
    for (const d of ['2026-10-21', '2026-10-22', '2026-10-23']) l.late(B, '09:10', { workDate: d });
    expect(streak(l.state, B)).toEqual({ kind: 'late', count: 3 });
    l.run(A, { type: 'RecordArrival', playerId: B, workDate: '2026-10-24', arrivedAt: '08:50' });
    expect(streak(l.state, B)).toEqual({ kind: 'onTime', count: 1 });
    l.late(B, '09:30', { workDate: '2026-10-24' });
    expect(streak(l.state, B)).toEqual({ kind: 'late', count: 4 });
  });
});

import { describe, expect, it } from 'vitest';
import { asPlayerId, currentRuleset, DEFAULT_RULESET, rulesetAt } from '../src';
import { A, B, C, createLedger } from './harness';

describe('players', () => {
  it('first player bootstraps as owner, later ones are members', () => {
    const l = createLedger();
    l.join(A, B);
    expect(l.state.players[A]?.role).toBe('owner');
    expect(l.state.players[B]?.role).toBe('member');
    expect(l.state.towers[B]?.cups).toEqual([]);
  });

  it('requires an active actor after bootstrap', () => {
    const l = createLedger();
    l.join(A);
    expect(l.fail(asPlayerId('stranger'), { type: 'AddPlayer', name: 'X', appearance: { color: '#000' } }).code).toBe(
      'NotPermitted',
    );
    expect(l.fail(asPlayerId('stranger'), { type: 'RecordArrival', playerId: A, arrivedAt: '09:30' }).code).toBe(
      'NotPermitted',
    );
  });

  it('validates new players', () => {
    const l = createLedger();
    l.join(A, B);
    expect(l.fail(A, { type: 'AddPlayer', name: '  ', appearance: { color: '#000' } }).code).toBe('InvalidInput');
    expect(l.fail(A, { type: 'AddPlayer', id: B, name: 'dup', appearance: { color: '#000' } }).code).toBe(
      'InvalidInput',
    );
    expect(
      l.fail(A, { type: 'AddPlayer', name: 'x', appearance: { color: '#000' }, startTimeOverride: '25:00' }).code,
    ).toBe('InvalidInput');
    expect(l.fail(B, { type: 'AddPlayer', name: 'x', appearance: { color: '#000' }, role: 'owner' }).code).toBe(
      'NotPermitted',
    );
    l.run(A, { type: 'AddPlayer', id: C, name: ' 서연 ', appearance: { color: '#000' }, role: 'owner' });
    expect(l.state.players[C]).toMatchObject({ name: '서연', role: 'owner' });
  });

  it('members edit only themselves; only owners archive', () => {
    const l = createLedger();
    l.join(A, B, C);
    l.run(B, { type: 'UpdatePlayer', playerId: B, patch: { name: ' 민수 ', startTimeOverride: '10:00' } });
    expect(l.state.players[B]).toMatchObject({ name: '민수', startTimeOverride: '10:00' });
    l.run(B, { type: 'UpdatePlayer', playerId: B, patch: { startTimeOverride: null } });
    expect(l.state.players[B]).not.toHaveProperty('startTimeOverride');
    l.run(B, { type: 'UpdatePlayer', playerId: B, patch: { name: '민수' } });
    expect(l.state.players[B]?.name).toBe('민수');
    expect(l.fail(B, { type: 'UpdatePlayer', playerId: C, patch: { name: 'x' } }).code).toBe('NotPermitted');
    expect(l.fail(B, { type: 'UpdatePlayer', playerId: B, patch: { archived: true } }).code).toBe('NotPermitted');
    expect(l.fail(B, { type: 'UpdatePlayer', playerId: B, patch: { name: '' } }).code).toBe('InvalidInput');
    expect(l.fail(B, { type: 'UpdatePlayer', playerId: B, patch: { startTimeOverride: 'x' } }).code).toBe(
      'InvalidInput',
    );
    expect(l.fail(A, { type: 'UpdatePlayer', playerId: asPlayerId('nope'), patch: {} }).code).toBe('PlayerNotFound');
    l.run(A, { type: 'UpdatePlayer', playerId: C, patch: { archived: true } });
    expect(l.fail(C, { type: 'RecordArrival', playerId: A, arrivedAt: '09:30' }).code).toBe('NotPermitted');
  });
});

describe('ruleset changes', () => {
  it('only owners change the ruleset, and it must be valid', () => {
    const l = createLedger();
    l.join(A, B);
    const rs = { ...DEFAULT_RULESET, graceMinutes: 5 };
    expect(l.fail(B, { type: 'ChangeRuleset', ruleset: rs }).code).toBe('NotPermitted');
    const bad = l.fail(A, { type: 'ChangeRuleset', ruleset: { ...rs, graceMinutes: -1 } });
    expect(bad.code).toBe('InvalidRuleset');
    expect(bad.detail?.issues).toHaveLength(1);
    l.run(A, { type: 'ChangeRuleset', ruleset: rs });
    expect(currentRuleset(l.state).graceMinutes).toBe(5);
  });

  it('resolves the ruleset in force on a date; later same-day change wins', () => {
    const l = createLedger();
    l.join(A);
    l.setToday('2026-10-01');
    l.run(A, { type: 'ChangeRuleset', ruleset: { ...DEFAULT_RULESET, graceMinutes: 2 } });
    l.setToday('2026-10-20');
    l.run(A, { type: 'ChangeRuleset', ruleset: { ...DEFAULT_RULESET, graceMinutes: 3 } });
    l.run(A, { type: 'ChangeRuleset', ruleset: { ...DEFAULT_RULESET, graceMinutes: 4 } });
    expect(rulesetAt(l.state, '2026-09-01').graceMinutes).toBe(2); // before any change: earliest known
    expect(rulesetAt(l.state, '2026-10-19').graceMinutes).toBe(2);
    expect(rulesetAt(l.state, '2026-10-20').graceMinutes).toBe(4);
    expect(rulesetAt(createLedger().state, '2026-10-20')).toEqual(DEFAULT_RULESET);
  });

  it('keeps rulesets ordered even when a change for an earlier date arrives later', () => {
    const l = createLedger();
    l.join(A);
    l.setToday('2026-10-20');
    const later = l.decideOnly(A, { type: 'ChangeRuleset', ruleset: { ...DEFAULT_RULESET, graceMinutes: 9 } });
    l.setToday('2026-10-10');
    const earlier = l.decideOnly(A, { type: 'ChangeRuleset', ruleset: { ...DEFAULT_RULESET, graceMinutes: 3 } });
    l.apply(...later, ...earlier);
    expect(l.state.rulesets.map((r) => r.effectiveFrom)).toEqual(['2026-10-10', '2026-10-20']);
  });
});

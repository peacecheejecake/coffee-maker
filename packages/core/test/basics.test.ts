import { describe, expect, it } from 'vitest';
import {
  addHours,
  computeCups,
  creditGrade,
  cupAge,
  daysBetween,
  DEFAULT_RULESET,
  isHHmm,
  isWorkDate,
  judgeLateness,
  minutesBetween,
  toMinutes,
  upcast,
  validateRuleset,
  type CupRule,
  type Ruleset,
  type UpcasterRegistry,
} from '../src';

describe('time', () => {
  it('parses HH:mm', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('09:05')).toBe(545);
    expect(toMinutes('23:59')).toBe(1439);
    expect(isHHmm('24:00')).toBe(false);
    expect(isHHmm('9:05')).toBe(false);
    expect(() => toMinutes('nope')).toThrow(RangeError);
  });

  it('validates work dates including impossible days', () => {
    expect(isWorkDate('2026-10-23')).toBe(true);
    expect(isWorkDate('2026-02-30')).toBe(false);
    expect(isWorkDate('2026-1-3')).toBe(false);
  });

  it('does date and instant arithmetic', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(minutesBetween('2026-10-23T00:00:00Z', '2026-10-23T00:10:30Z')).toBe(10.5);
    expect(addHours('2026-10-23T00:00:00.000Z', 72)).toBe('2026-10-26T00:00:00.000Z');
  });
});

describe('judgeLateness (start 09:00, grace 1)', () => {
  it.each([
    ['08:59', 0, false],
    ['09:00', 0, false],
    ['09:01', 1, false],
    ['09:02', 2, true],
    ['10:30', 90, true],
  ])('arrived %s → %i min, late=%s', (arrivedAt, minutesLate, isLate) => {
    expect(judgeLateness(arrivedAt, '09:00', 1)).toEqual({ minutesLate, isLate });
  });

  it('grace 0 makes one minute late', () => {
    expect(judgeLateness('09:01', '09:00', 0).isLate).toBe(true);
  });
});

describe('computeCups', () => {
  const tiered: CupRule = {
    mode: 'tiered',
    tiers: [
      { upToMinutes: 15, cups: 1 },
      { upToMinutes: 60, cups: 2 },
      { upToMinutes: null, cups: 3 },
    ],
  };
  const late = (m: number) => ({ minutesLate: m, isLate: true });

  it('fixed rule ignores how late', () => {
    expect(computeCups(late(2), { mode: 'fixed', cups: 1 })).toBe(1);
    expect(computeCups(late(200), { mode: 'fixed', cups: 1 })).toBe(1);
  });

  it('on time costs nothing', () => {
    expect(computeCups({ minutesLate: 1, isLate: false }, tiered)).toBe(0);
  });

  it.each([
    [2, 1],
    [15, 1],
    [16, 2],
    [60, 2],
    [61, 3],
  ])('tiered: %i min → %i cups', (m, cups) => {
    expect(computeCups(late(m), tiered)).toBe(cups);
  });
});

describe('validateRuleset', () => {
  const withRule = (cupRule: CupRule): Ruleset => ({ ...DEFAULT_RULESET, cupRule });
  const paths = (rs: Ruleset) => validateRuleset(rs).map((i) => i.path);

  it('accepts the default', () => {
    expect(validateRuleset(DEFAULT_RULESET)).toEqual([]);
  });

  it('rejects out-of-range scalars', () => {
    expect(
      paths({
        ...DEFAULT_RULESET,
        defaultStartTime: '9am',
        graceMinutes: 31,
        timezone: ' ',
        waivePolicy: { mode: 'unanimous', ttlHours: 1 },
        cupRule: { mode: 'fixed', cups: 0 },
      }),
    ).toEqual(['defaultStartTime', 'graceMinutes', 'timezone', 'waivePolicy.ttlHours', 'cupRule.cups']);
  });

  it('checks tier ordering and the unbounded last tier', () => {
    expect(paths(withRule({ mode: 'tiered', tiers: [] }))).toEqual(['cupRule.tiers']);
    expect(
      paths(
        withRule({
          mode: 'tiered',
          tiers: [
            { upToMinutes: 30, cups: 1 },
            { upToMinutes: 30, cups: 2 },
            { upToMinutes: null, cups: 0 },
          ],
        }),
      ),
    ).toEqual(['cupRule.tiers.1.upToMinutes', 'cupRule.tiers.2.cups']);
    expect(
      paths(
        withRule({
          mode: 'tiered',
          tiers: [
            { upToMinutes: null, cups: 1 },
            { upToMinutes: 10, cups: 1 },
          ],
        }),
      ),
    ).toEqual(['cupRule.tiers.0.upToMinutes', 'cupRule.tiers.1.upToMinutes']);
  });
});

describe('credit & aging', () => {
  it.each([
    [0, 'AAA'],
    [2, 'A'],
    [3, 'B'],
    [5, 'B'],
    [6, 'C'],
    [9, 'C'],
    [10, 'D'],
  ])('%i outstanding → %s', (n, grade) => {
    expect(creditGrade(n)).toBe(grade);
  });

  it.each([
    ['2026-10-23', 'fresh'],
    ['2026-10-16', 'cobweb'],
    ['2026-09-23', 'ghost'],
    ['2026-07-15', 'rip'],
  ])('cup issued %s is %s on 2026-10-23', (issuedOn, age) => {
    expect(cupAge(issuedOn, '2026-10-23')).toBe(age);
  });
});

describe('upcast', () => {
  const raw = { id: 'e1', type: 'LateRecorded', schemaVersion: 1, note: 'x' };

  it('returns current-version events unchanged', () => {
    expect(upcast(raw)).toEqual(raw);
  });

  it('chains registered steps and bumps versions', () => {
    const registry: UpcasterRegistry = {
      LateRecorded: {
        1: (e) => ({ ...e, note: `${String(e.note)}!` }),
        2: (e) => ({ ...e, note: `${String(e.note)}?` }),
      },
    };
    expect(upcast(raw, registry, 3)).toEqual({ ...raw, schemaVersion: 3, note: 'x!?' });
  });

  it('refuses events from a newer build', () => {
    expect(() => upcast({ ...raw, schemaVersion: 2 })).toThrow(/supports up to v1/);
  });
});

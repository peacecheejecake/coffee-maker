import { describe, expect, it } from 'vitest';
import {
  checkInBlocker,
  checkPlace,
  DEFAULT_RULESET,
  distanceMeters,
  isValidRuleset,
  validateRuleset,
  type GeoFix,
  type Ruleset,
  type Workplace,
} from '../src';
import { A, B, C, createLedger, type Ledger } from './harness';

/** Seoul City Hall. 0.001° of latitude is ~111 m. */
const OFFICE: Workplace = { lat: 37.5665, lng: 126.978, radiusMeters: 150, label: '본사' };
const fix = (dLat: number, accuracyMeters = 20): GeoFix => ({ lat: OFFICE.lat + dLat, lng: OFFICE.lng, accuracyMeters });

describe('distance', () => {
  it('is the great-circle distance in meters', () => {
    expect(distanceMeters(OFFICE, OFFICE)).toBe(0);
    expect(distanceMeters(OFFICE, fix(0.001))).toBeCloseTo(111.2, 0);
    // Seoul City Hall → Busan City Hall is about 325 km.
    expect(distanceMeters(OFFICE, { lat: 35.1798, lng: 129.075 }) / 1000).toBeCloseTo(325, -1);
  });
});

describe('checkPlace', () => {
  it('is inside within the radius', () => {
    expect(checkPlace(OFFICE, fix(0.001)).kind).toBe('inside');
    expect(checkPlace(OFFICE, fix(0.003)).kind).toBe('outside');
  });

  it('gives a fix the benefit of its own accuracy, so indoor drift does not lock anyone out', () => {
    // ~167 m away: outside the 150 m radius, but a ±30 m reading reaches into it.
    expect(checkPlace(OFFICE, fix(0.0015, 30)).kind).toBe('inside');
    expect(checkPlace(OFFICE, fix(0.0015, 5)).kind).toBe('outside');
  });

  it('does not trust vague readings either way', () => {
    // An IP-based guess (±2 km) right on the office still proves nothing.
    expect(checkPlace(OFFICE, fix(0, 2000))).toMatchObject({ kind: 'uncertain', accuracyMeters: 2000 });
    // The cap is the radius when the radius is larger than 100 m.
    expect(checkPlace(OFFICE, fix(0, 140)).kind).toBe('inside');
    expect(checkPlace({ ...OFFICE, radiusMeters: 50 }, fix(0, 140)).kind).toBe('uncertain');
  });
});

describe('workplace in the ruleset', () => {
  const rs = (workplace: unknown): Ruleset => ({ ...DEFAULT_RULESET, workplace: workplace as Workplace });

  it('is optional: rulesets without one stay valid', () => {
    expect(validateRuleset(DEFAULT_RULESET)).toEqual([]);
    expect(validateRuleset(rs(OFFICE))).toEqual([]);
    expect(validateRuleset(rs({ lat: 1, lng: 2, radiusMeters: 50 }))).toEqual([]);
  });

  it('rejects out-of-range coordinates, radius and labels', () => {
    const paths = (w: unknown) => validateRuleset(rs(w)).map((i) => i.path);
    expect(paths({ ...OFFICE, lat: 91 })).toEqual(['workplace.lat']);
    expect(paths({ ...OFFICE, lng: Number.NaN })).toEqual(['workplace.lng']);
    expect(paths({ ...OFFICE, radiusMeters: 20 })).toEqual(['workplace.radiusMeters']);
    expect(paths({ ...OFFICE, radiusMeters: 150.5 })).toEqual(['workplace.radiusMeters']);
    expect(paths({ ...OFFICE, label: 'x'.repeat(41) })).toEqual(['workplace.label']);
    expect(paths(null)).toEqual(['workplace']);
    expect(isValidRuleset(rs('here'))).toBe(false);
  });
});

/** A, B, C in attendance mode with the office as workplace, adopted Fri 10-23; the clock is Mon 10-26 08:50. */
function withWorkplace(): Ledger {
  const l = createLedger();
  l.join(A, B, C);
  l.claim(B, C);
  l.run(A, { type: 'ChangeMode', mode: 'attendance' });
  l.run(A, { type: 'AdoptRules', ruleset: { ...DEFAULT_RULESET, workplace: OFFICE } });
  l.advanceMinutes(3 * 24 * 60 - 10);
  l.setToday('2026-10-26');
  return l;
}

describe('check-in with a workplace', () => {
  it('needs a position inside the area, and the event never carries it', () => {
    const l = withWorkplace();
    expect(l.fail(B, { type: 'CheckIn' }).code).toBe('LocationRequired');
    expect(l.fail(B, { type: 'CheckIn', position: { lat: 'x' } as unknown as GeoFix }).code).toBe('LocationRequired');
    const away = l.fail(B, { type: 'CheckIn', position: fix(0.01) });
    expect(away.code).toBe('OutsideWorkplace');
    expect(away.detail?.distanceMeters).toBeGreaterThan(1000);
    expect(l.fail(B, { type: 'CheckIn', position: fix(0, 3000) }).code).toBe('LocationUncertain');

    const [e] = l.run(B, { type: 'CheckIn', position: fix(0.0005) });
    expect(e).toMatchObject({ type: 'CheckedIn', workDate: '2026-10-26' });
    expect(JSON.stringify(e)).not.toContain('37.5');
    expect(l.state.attendance.days[`${B}|2026-10-26`]).toBe('checkIn');
  });

  it('other blockers come first, whatever the position', () => {
    const l = withWorkplace();
    l.run(B, { type: 'CheckIn', position: fix(0) });
    expect(l.fail(B, { type: 'CheckIn', position: fix(0.01) }).code).toBe('AlreadyCheckedIn');
    expect(checkInBlocker(l.state, B, '2026-10-26')).toBe('checkedIn');
    expect(checkInBlocker(l.state, C, '2026-10-26')).toBeNull();
    expect(checkInBlocker(l.state, C, '2026-10-24')).toBe('dayOff');
    expect(checkInBlocker(l.state, C, '2026-10-23')).toBe('notStarted');
  });

  it('the workplace changes like any rule: by a unanimous motion, and removing it frees check-ins', () => {
    const l = withWorkplace();
    const moved = { ...OFFICE, lat: OFFICE.lat + 0.01 };
    const [p] = l.run(B, { type: 'ProposeMotion', motion: { kind: 'ruleset', ruleset: { ...DEFAULT_RULESET, workplace: moved } } });
    l.run(A, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' });
    l.run(C, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' });
    expect(l.state.rulesets.at(-1)?.ruleset.workplace).toEqual(moved);
    expect(l.fail(B, { type: 'CheckIn', position: fix(0) }).code).toBe('OutsideWorkplace');
    l.run(B, { type: 'CheckIn', position: fix(0.01) });

    const [q] = l.run(C, { type: 'ProposeMotion', motion: { kind: 'ruleset', ruleset: DEFAULT_RULESET } });
    l.run(A, { type: 'VoteMotion', motionId: q!.id, vote: 'approve' });
    l.run(B, { type: 'VoteMotion', motionId: q!.id, vote: 'approve' });
    l.run(C, { type: 'CheckIn' });
    expect(l.state.attendance.days[`${C}|2026-10-26`]).toBe('checkIn');
  });

  it('an invalid workplace cannot be adopted or proposed', () => {
    const l = createLedger();
    l.join(A);
    l.run(A, { type: 'ChangeMode', mode: 'attendance' });
    const bad = { ...DEFAULT_RULESET, workplace: { ...OFFICE, radiusMeters: 5 } };
    expect(l.fail(A, { type: 'AdoptRules', ruleset: bad }).code).toBe('InvalidRuleset');
    l.run(A, { type: 'AdoptRules', ruleset: DEFAULT_RULESET });
    expect(l.fail(A, { type: 'ProposeMotion', motion: { kind: 'ruleset', ruleset: bad } }).code).toBe('InvalidRuleset');
  });
});

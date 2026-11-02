import { describe, expect, it } from 'vitest';
import {
  checkInBlocker,
  checkPlace,
  DEFAULT_RULESET,
  distanceMeters,
  distanceToArea,
  isSelfIntersecting,
  movePolygon,
  polygonAreaM2,
  polygonCenter,
  regularPolygon,
  isValidRuleset,
  validateRuleset,
  type GeoFix,
  type LatLng,
  type PolygonArea,
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

/** Meters → degrees near Seoul (≈111 km per degree of latitude, ≈88 km per degree of longitude). */
const north = (m: number) => m / 111_195;
const east = (m: number) => m / (111_195 * Math.cos((OFFICE.lat * Math.PI) / 180));
const at = (eastM: number, northM: number): LatLng => ({ lat: OFFICE.lat + north(northM), lng: OFFICE.lng + east(eastM) });

/** An L-shaped building: 200 m × 200 m with the north-east 100 m × 100 m quarter cut out. */
const L_SHAPE: PolygonArea = {
  kind: 'polygon',
  label: '별관',
  points: [at(0, 0), at(200, 0), at(200, 100), at(100, 100), at(100, 200), at(0, 200)],
};
const fixAt = (eastM: number, northM: number, accuracyMeters = 10): GeoFix => ({ ...at(eastM, northM), accuracyMeters });

describe('polygon areas', () => {
  it('contains points inside, not those in the cut-out corner', () => {
    expect(distanceToArea(L_SHAPE, at(50, 50))).toBe(0);
    expect(distanceToArea(L_SHAPE, at(50, 150))).toBe(0);
    expect(checkPlace(L_SHAPE, fixAt(150, 50)).kind).toBe('inside');
    // In the notch: 50 m from both inner edges.
    expect(distanceToArea(L_SHAPE, at(150, 150))).toBeCloseTo(50, 0);
    expect(checkPlace(L_SHAPE, fixAt(150, 150)).kind).toBe('outside');
  });

  it('measures the distance to the nearest edge, and gives the reading its accuracy', () => {
    expect(distanceToArea(L_SHAPE, at(-30, 100))).toBeCloseTo(30, 0);
    // Beyond a corner the nearest point is the vertex.
    expect(distanceToArea(L_SHAPE, at(-30, -40))).toBeCloseTo(50, 0);
    expect(checkPlace(L_SHAPE, fixAt(-30, 100, 35)).kind).toBe('inside');
    expect(checkPlace(L_SHAPE, fixAt(-30, 100, 20))).toMatchObject({ kind: 'outside' });
    expect((checkPlace(L_SHAPE, fixAt(-30, 100, 20)) as { distanceMeters: number }).distanceMeters).toBeCloseTo(30, 0);
  });

  it('distrusts readings vaguer than the area is wide', () => {
    // Farthest vertex from the center is ~133 m away, so ±120 m is still usable and ±200 m is not.
    expect(checkPlace(L_SHAPE, fixAt(50, 50, 120)).kind).toBe('inside');
    expect(checkPlace(L_SHAPE, fixAt(50, 50, 200)).kind).toBe('uncertain');
  });

  it('detects crossing edges', () => {
    expect(isSelfIntersecting(L_SHAPE.points)).toBe(false);
    const bowtie = [at(0, 0), at(100, 100), at(100, 0), at(0, 100)];
    expect(isSelfIntersecting(bowtie)).toBe(true);
    // A vertex touching a non-adjacent edge also counts.
    expect(isSelfIntersecting([at(0, 0), at(100, 0), at(50, 0), at(50, 100)])).toBe(true);
  });

  it('builds and moves shapes for the editor', () => {
    const hex = regularPolygon(OFFICE, 150, 6);
    expect(hex).toHaveLength(6);
    for (const p of hex) expect(distanceMeters(OFFICE, p)).toBeCloseTo(150, 0);
    expect(polygonAreaM2(hex)).toBeCloseTo((3 * Math.sqrt(3) * 150 ** 2) / 2, -2);
    const moved = movePolygon(hex, { lat: 35, lng: 129 });
    expect(polygonCenter(moved).lat).toBeCloseTo(35, 9);
    expect(polygonCenter(moved).lng).toBeCloseTo(129, 9);
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
    expect(paths({ ...OFFICE, kind: 'hexagon' })).toEqual(['workplace.kind']);
  });

  it('accepts circles with or without a kind, and well-formed polygons', () => {
    expect(validateRuleset(rs({ ...OFFICE, kind: 'circle' }))).toEqual([]);
    expect(validateRuleset(rs(L_SHAPE))).toEqual([]);
    expect(validateRuleset(rs({ kind: 'polygon', points: regularPolygon(OFFICE, 900, 20) }))).toEqual([]);
  });

  it('rejects polygons with too few or many points, bad points, crossings, or a silly size', () => {
    const paths = (points: unknown) => validateRuleset(rs({ kind: 'polygon', points })).map((i) => `${i.path} ${i.message}`);
    expect(paths(L_SHAPE.points.slice(0, 2))).toEqual(['workplace.points needs 3–20 points']);
    expect(paths(regularPolygon(OFFICE, 100, 21))).toEqual(['workplace.points needs 3–20 points']);
    expect(paths('square')).toEqual(['workplace.points needs 3–20 points']);
    expect(paths([at(0, 0), { lat: 100, lng: 0 }, at(0, 100)])).toEqual(['workplace.points.1 out of range']);
    expect(paths([at(0, 0), at(100, 100), at(100, 0), at(0, 100)])).toEqual(['workplace.points edges cross']);
    expect(paths(regularPolygon(OFFICE, 1100, 6))).toEqual(['workplace.points too large']);
    expect(paths([at(0, 0), at(50, 0), at(100, 0)])).toEqual(['workplace.points too small']);
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
    // ~1.1 km from the center, ~960 m from the edge.
    expect(away.detail?.distanceMeters).toBeCloseTo(962, -1);
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

  it('a polygon workplace works the same way', () => {
    const l = withWorkplace();
    const [p] = l.run(B, { type: 'ProposeMotion', motion: { kind: 'ruleset', ruleset: { ...DEFAULT_RULESET, workplace: L_SHAPE } } });
    l.run(A, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' });
    l.run(C, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' });
    expect(l.fail(B, { type: 'CheckIn', position: fixAt(150, 150) }).code).toBe('OutsideWorkplace');
    l.run(B, { type: 'CheckIn', position: fixAt(150, 50) });
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

/**
 * The group's workplace (출두 구역) and whether a device-reported position is inside it.
 *
 * Positions come from the member's own device and are never stored in events: the server cannot verify them,
 * so the area is an honesty aid, not proof (docs/DESIGN.md §2.7).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A center and radius. `kind` is optional: circles from before polygons existed have none. */
export interface CircleArea {
  kind?: 'circle';
  lat: number;
  lng: number;
  radiusMeters: number;
  /** What members see instead of coordinates, e.g. "본사 3층". */
  label?: string;
}

/** A simple (non-self-intersecting) polygon, vertices in order; the closing edge is implied. */
export interface PolygonArea {
  kind: 'polygon';
  points: LatLng[];
  label?: string;
}

export type Workplace = CircleArea | PolygonArea;

export const isPolygonArea = (w: Workplace): w is PolygonArea => w.kind === 'polygon';

/** One position reading from a device. `accuracyMeters` is the reported 68% radius, as in the Geolocation API. */
export interface GeoFix {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

export const WORKPLACE_LIMITS = {
  radiusMeters: { min: 50, max: 1000 },
  labelLength: 40,
  polygonPoints: { min: 3, max: 20 },
  /** Longest distance between two vertices: the same 2 km a largest circle spans. */
  polygonMaxExtentMeters: 2000,
  /** Rules out collapsed shapes (all points on a line, or on top of each other). */
  polygonMinAreaM2: 100,
} as const;

export const DEFAULT_WORKPLACE_RADIUS = 150;

/**
 * A reading vaguer than this (or than the area's radius, if larger) cannot place anyone in an area; Wi-Fi and GPS
 * fixes are usually well under it, IP-based desktop guesses are not.
 */
export const MAX_FIX_ACCURACY_METERS = 100;

const EARTH_RADIUS_METERS = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;
const METERS_PER_DEGREE = (EARTH_RADIUS_METERS * Math.PI) / 180;

/** Great-circle (haversine) distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── planar geometry ─────────────────────────────────────────────────────────
// Areas span at most a few km, so a flat (equirectangular) projection around the area is accurate to well under
// a meter there. Areas across the antimeridian are not supported (their extent check fails).

interface XY {
  x: number;
  y: number;
}

/** Plain mean of the vertices: a reference point inside (or near) any reasonable shape. */
export const polygonCenter = (points: readonly LatLng[]): LatLng => ({
  lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
  lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
});

/** Projects to meters east (x) and north (y) of `ref`. */
function projector(ref: LatLng): (p: LatLng) => XY {
  const cos = Math.cos(rad(ref.lat));
  return (p) => ({ x: (p.lng - ref.lng) * METERS_PER_DEGREE * cos, y: (p.lat - ref.lat) * METERS_PER_DEGREE });
}

function pointInRing(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const edges = <T>(ring: readonly T[]): [T, T][] => ring.map((a, i) => [a, ring[(i + 1) % ring.length]!]);

const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Proper or touching intersection of segments ab and cd. */
function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  // Collinear: r lies on pq when it is within pq's bounding box.
  const on = (p: XY, q: XY, r: XY) =>
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  return (d1 === 0 && on(c, d, a)) || (d2 === 0 && on(c, d, b)) || (d3 === 0 && on(a, b, c)) || (d4 === 0 && on(a, b, d));
}

/** Whether any two non-adjacent edges of the ring cross or touch. */
export function isSelfIntersecting(points: readonly LatLng[]): boolean {
  const ring = points.map(projector(polygonCenter(points)));
  const es = edges(ring);
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      // Neighbors share a vertex; the first and last edge are neighbors too.
      if (j === i + 1 || (i === 0 && j === es.length - 1)) continue;
      if (segmentsIntersect(es[i]![0], es[i]![1], es[j]![0], es[j]![1])) return true;
    }
  }
  return false;
}

/** Shoelace area in m². */
export function polygonAreaM2(points: readonly LatLng[]): number {
  const ring = points.map(projector(polygonCenter(points)));
  return Math.abs(edges(ring).reduce((s, [a, b]) => s + a.x * b.y - b.x * a.y, 0)) / 2;
}

/** Meters from `p` to the area: 0 inside, otherwise to the nearest edge. */
export function distanceToArea(w: Workplace, p: LatLng): number {
  if (!isPolygonArea(w)) return Math.max(0, distanceMeters(w, p) - w.radiusMeters);
  const project = projector(polygonCenter(w.points));
  const ring = w.points.map(project);
  const q = project(p);
  if (pointInRing(q, ring)) return 0;
  return Math.min(...edges(ring).map(([a, b]) => distanceToSegment(q, a, b)));
}

/** The circle that holds the area, as seen from its center: the polygon's farthest vertex. */
export function areaRadius(w: Workplace): number {
  if (!isPolygonArea(w)) return w.radiusMeters;
  const c = polygonCenter(w.points);
  return Math.max(...w.points.map((p) => distanceMeters(c, p)));
}

export const areaCenter = (w: Workplace): LatLng => (isPolygonArea(w) ? polygonCenter(w.points) : { lat: w.lat, lng: w.lng });

/** `n` vertices on a circle of `radiusMeters` around `center`, starting north, clockwise. */
export function regularPolygon(center: LatLng, radiusMeters: number, n: number): LatLng[] {
  const cos = Math.cos(rad(center.lat));
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return {
      lat: center.lat + (radiusMeters * Math.cos(a)) / METERS_PER_DEGREE,
      lng: center.lng + (radiusMeters * Math.sin(a)) / (METERS_PER_DEGREE * cos),
    };
  });
}

/** The same shape moved so its center is at `to`. */
export function movePolygon(points: readonly LatLng[], to: LatLng): LatLng[] {
  const c = polygonCenter(points);
  return points.map((p) => ({ lat: p.lat + to.lat - c.lat, lng: p.lng + to.lng - c.lng }));
}

// ── the check ───────────────────────────────────────────────────────────────

export type PlaceCheck =
  /** `distanceMeters` is to the area's edge, 0 when the reading itself is inside. */
  | { kind: 'inside'; distanceMeters: number }
  | { kind: 'outside'; distanceMeters: number }
  /** The reading is too vague to decide either way; try again (outdoors, with precise location on). */
  | { kind: 'uncertain'; distanceMeters: number; accuracyMeters: number };

/**
 * Inside when the reading's uncertainty circle reaches the area: GPS indoors drifts by tens of meters, and a
 * strict test would lock out someone sitting at their desk. Readings vaguer than
 * `max(area radius, MAX_FIX_ACCURACY_METERS)` are not trusted at all.
 */
export function checkPlace(workplace: Workplace, fix: GeoFix): PlaceCheck {
  const d = distanceToArea(workplace, fix);
  const accuracy = Math.max(0, fix.accuracyMeters);
  if (accuracy > Math.max(areaRadius(workplace), MAX_FIX_ACCURACY_METERS)) {
    return { kind: 'uncertain', distanceMeters: d, accuracyMeters: accuracy };
  }
  return d <= accuracy ? { kind: 'inside', distanceMeters: d } : { kind: 'outside', distanceMeters: d };
}

// ── validation ──────────────────────────────────────────────────────────────

const isFiniteIn = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isLatLng = (p: unknown): p is LatLng =>
  typeof p === 'object' && p !== null && isFiniteIn((p as LatLng).lat, -90, 90) && isFiniteIn((p as LatLng).lng, -180, 180);

export const isGeoFix = (v: unknown): v is GeoFix => isLatLng(v) && isFiniteIn((v as GeoFix).accuracyMeters, 0, Infinity);

/** Issues with a workplace, as `[path, message]` pairs relative to it. Never throws on malformed input. */
export function workplaceIssues(w: Workplace): [string, string][] {
  const issues: [string, string][] = [];
  if (typeof w !== 'object' || w === null) return [['', 'must be an object']];
  if (w.label !== undefined && (typeof w.label !== 'string' || w.label.length > WORKPLACE_LIMITS.labelLength)) {
    issues.push(['label', 'too long']);
  }
  const kind: unknown = w.kind;
  if (kind === 'polygon') return [...issues, ...polygonIssues((w as PolygonArea).points)];
  if (kind !== undefined && kind !== 'circle') return [...issues, ['kind', 'unknown shape']];
  const c = w as CircleArea;
  if (!isFiniteIn(c.lat, -90, 90)) issues.push(['lat', 'out of range']);
  if (!isFiniteIn(c.lng, -180, 180)) issues.push(['lng', 'out of range']);
  const r = WORKPLACE_LIMITS.radiusMeters;
  if (!Number.isInteger(c.radiusMeters) || c.radiusMeters < r.min || c.radiusMeters > r.max) issues.push(['radiusMeters', 'out of range']);
  return issues;
}

function polygonIssues(points: unknown): [string, string][] {
  const { min, max } = WORKPLACE_LIMITS.polygonPoints;
  if (!Array.isArray(points) || points.length < min || points.length > max) return [['points', `needs ${min}–${max} points`]];
  const bad = points.findIndex((p) => !isLatLng(p));
  if (bad !== -1) return [[`points.${bad}`, 'out of range']];
  const ps = points as LatLng[];
  let extent = 0;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) extent = Math.max(extent, distanceMeters(ps[i]!, ps[j]!));
  if (extent > WORKPLACE_LIMITS.polygonMaxExtentMeters) return [['points', 'too large']];
  // Crossing first: a crossed shape's signed area cancels out, and "too small" would be misleading.
  if (isSelfIntersecting(ps)) return [['points', 'edges cross']];
  if (polygonAreaM2(ps) < WORKPLACE_LIMITS.polygonMinAreaM2) return [['points', 'too small']];
  return [];
}

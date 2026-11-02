/**
 * The group's workplace (출두 구역) and whether a device-reported position is inside it.
 *
 * Positions come from the member's own device and are never stored in events: the server cannot verify them,
 * so the area is an honesty aid, not proof (docs/DESIGN.md §2.7).
 */

export interface Workplace {
  lat: number;
  lng: number;
  radiusMeters: number;
  /** What members see instead of coordinates, e.g. "본사 3층". */
  label?: string;
}

/** One position reading from a device. `accuracyMeters` is the reported 68% radius, as in the Geolocation API. */
export interface GeoFix {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

export const WORKPLACE_LIMITS = {
  radiusMeters: { min: 50, max: 1000 },
  labelLength: 40,
} as const;

export const DEFAULT_WORKPLACE_RADIUS = 150;

/**
 * A reading vaguer than this (or than the radius, if larger) cannot place anyone in an area; Wi-Fi and GPS fixes
 * are usually well under it, IP-based desktop guesses are not.
 */
export const MAX_FIX_ACCURACY_METERS = 100;

const EARTH_RADIUS_METERS = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance in meters. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PlaceCheck =
  | { kind: 'inside'; distanceMeters: number }
  | { kind: 'outside'; distanceMeters: number }
  /** The reading is too vague to decide either way; try again (outdoors, with precise location on). */
  | { kind: 'uncertain'; distanceMeters: number; accuracyMeters: number };

/**
 * Inside when the reading's uncertainty circle reaches the area: GPS indoors drifts by tens of meters, and a
 * strict center test would lock out someone sitting at their desk. Readings vaguer than
 * `max(radius, MAX_FIX_ACCURACY_METERS)` are not trusted at all.
 */
export function checkPlace(workplace: Workplace, fix: GeoFix): PlaceCheck {
  const d = distanceMeters(workplace, fix);
  const accuracy = Math.max(0, fix.accuracyMeters);
  if (accuracy > Math.max(workplace.radiusMeters, MAX_FIX_ACCURACY_METERS)) {
    return { kind: 'uncertain', distanceMeters: d, accuracyMeters: accuracy };
  }
  return d - accuracy <= workplace.radiusMeters ? { kind: 'inside', distanceMeters: d } : { kind: 'outside', distanceMeters: d };
}

const isFiniteIn = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export const isGeoFix = (v: unknown): v is GeoFix => {
  const f = v as GeoFix | null;
  return (
    typeof f === 'object' &&
    f !== null &&
    isFiniteIn(f.lat, -90, 90) &&
    isFiniteIn(f.lng, -180, 180) &&
    isFiniteIn(f.accuracyMeters, 0, Infinity)
  );
};

/** Issues with a workplace, as `[path, message]` pairs relative to it. Never throws on malformed input. */
export function workplaceIssues(w: Workplace): [string, string][] {
  const issues: [string, string][] = [];
  if (typeof w !== 'object' || w === null) return [['', 'must be an object']];
  if (!isFiniteIn(w.lat, -90, 90)) issues.push(['lat', 'out of range']);
  if (!isFiniteIn(w.lng, -180, 180)) issues.push(['lng', 'out of range']);
  const r = WORKPLACE_LIMITS.radiusMeters;
  if (!Number.isInteger(w.radiusMeters) || w.radiusMeters < r.min || w.radiusMeters > r.max) issues.push(['radiusMeters', 'out of range']);
  if (w.label !== undefined && (typeof w.label !== 'string' || w.label.length > WORKPLACE_LIMITS.labelLength)) {
    issues.push(['label', 'too long']);
  }
  return issues;
}

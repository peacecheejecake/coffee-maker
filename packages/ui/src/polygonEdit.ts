import { WORKPLACE_LIMITS, type LatLng } from '@coffee/core';

/** ~10 cm: more digits are noise, and the ruleset is shown to (and voted on by) everyone. */
export const roundLatLng = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });

export const canInsertVertex = (points: readonly LatLng[]) => points.length < WORKPLACE_LIMITS.polygonPoints.max;
export const canRemoveVertex = (points: readonly LatLng[]) => points.length > WORKPLACE_LIMITS.polygonPoints.min;

/** A new vertex on the edge after `index` (between it and the next one), at `at` or the edge's midpoint. */
export function insertVertex(points: readonly LatLng[], index: number, at?: LatLng): LatLng[] {
  if (!canInsertVertex(points)) return [...points];
  const a = points[index]!;
  const b = points[(index + 1) % points.length]!;
  const p = roundLatLng(at ?? { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
  return [...points.slice(0, index + 1), p, ...points.slice(index + 1)];
}

export const removeVertex = (points: readonly LatLng[], index: number): LatLng[] =>
  canRemoveVertex(points) ? points.filter((_, i) => i !== index) : [...points];

export const moveVertex = (points: readonly LatLng[], index: number, at: LatLng): LatLng[] =>
  points.map((p, i) => (i === index ? roundLatLng(at) : p));

/** Edge midpoints, where the map offers "add a vertex here" handles. */
export const midpoints = (points: readonly LatLng[]): LatLng[] =>
  points.map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  });

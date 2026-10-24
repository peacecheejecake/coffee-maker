import { describe, expect, it } from 'vitest';
import { clampView, ELEVATION_MAX, ELEVATION_MIN, orbitPosition, ZOOM_MAX, ZOOM_MIN } from '../src/camera/orbit';
import { frameBounds } from '../src/layout/framing';

describe('camera orbit', () => {
  it('with no user input lands exactly where the automatic framing puts the camera', () => {
    const f = frameBounds({ min: [-3, 0, -1], max: [3, 4, 1] }, { fovY: 35, aspect: 1.6, pitch: 14, margin: 0.06, minDistance: 5 });
    const d = Math.hypot(...f.position.map((p, i) => p - f.target[i]!));
    const p = orbitPosition(f.target, d, (14 * Math.PI) / 180, 0);
    p.forEach((v, i) => expect(v).toBeCloseTo(f.position[i]!, 9));
  });

  it('keeps the distance while turning', () => {
    const p = orbitPosition([1, 2, 3], 10, 0.4, 2);
    expect(Math.hypot(p[0] - 1, p[1] - 2, p[2] - 3)).toBeCloseTo(10, 9);
  });

  it('clamps zoom and elevation, not yaw', () => {
    const base = 0.25;
    const far = clampView({ yaw: 9, pitch: 5, zoom: 100 }, base);
    expect(far).toEqual({ yaw: 9, pitch: ELEVATION_MAX - base, zoom: ZOOM_MAX });
    const near = clampView({ yaw: 0, pitch: -5, zoom: 0 }, base);
    expect(near.zoom).toBe(ZOOM_MIN);
    expect(base + near.pitch).toBeCloseTo(ELEVATION_MIN, 12);
  });
});

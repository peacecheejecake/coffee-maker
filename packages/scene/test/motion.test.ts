import { describe, expect, it } from 'vitest';
import { arcPoint, flipAngle, landingScale, WOBBLE_SETTLE, WOBBLE_TRAVEL, wobbleAngle } from '../src/director/motion';

describe('motion curves', () => {
  it('wobble starts later for higher cups, is capped, and dies out', () => {
    expect(wobbleAngle(0.01, 0, 5)).not.toBe(0);
    expect(wobbleAngle(WOBBLE_TRAVEL * 3 - 0.001, 3, 5)).toBe(0);
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(wobbleAngle(i / 100, 0, 100))));
    expect(peak).toBeLessThanOrEqual((6 * Math.PI) / 180);
    expect(wobbleAngle(WOBBLE_SETTLE + 0.1, 0, 5)).toBe(0);
    // Taller towers sway more (below the cap).
    const amp = (size: number) => Math.max(...Array.from({ length: 50 }, (_, i) => Math.abs(wobbleAngle(i / 100, 0, size))));
    expect(amp(10)).toBeGreaterThan(amp(1));
  });

  it('landing squashes then returns to rest, preserving volume', () => {
    const [xz, y] = landingScale(0);
    expect(y).toBeCloseTo(0.8);
    expect(xz * xz * y).toBeCloseTo(1);
    expect(landingScale(1)).toEqual([1, 1]);
  });

  it('arc hits both ends and lifts in the middle', () => {
    expect(arcPoint([0, 0, 0], [2, 0, 0], 0, 1)).toEqual([0, 0, 0]);
    expect(arcPoint([0, 0, 0], [2, 0, 0], 1, 1)).toEqual([2, 0, 0]);
    expect(arcPoint([0, 0, 0], [2, 0, 0], 0.5, 1)).toEqual([1, 1, 0]);
  });

  it('flip turns once', () => {
    expect(flipAngle(0)).toBe(0);
    expect(flipAngle(0.6)).toBeCloseTo(Math.PI * 2);
    expect(flipAngle(0.7)).toBe(0);
  });
});

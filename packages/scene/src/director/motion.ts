/** Frame-rate independent motion curves. All take seconds and are pure, so they can be tested and skipped. */

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeInQuad = (t: number) => t * t;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Seconds for a landing wobble to die out; also how long a tower keeps requesting frames. */
export const WOBBLE_SETTLE = 2.2;
/** Delay between neighbouring cups: the impact travels up the stack. */
export const WOBBLE_TRAVEL = 0.03;

/**
 * Lean angle (radians) of cup `index` in a tower `t` seconds after an impact: a damped sine that starts
 * later the higher the cup, with taller towers swaying more (capped at 6°).
 */
export function wobbleAngle(t: number, index: number, towerSize: number): number {
  const local = t - index * WOBBLE_TRAVEL;
  if (local <= 0 || local > WOBBLE_SETTLE) return 0;
  const amplitude = Math.min((6 * Math.PI) / 180, ((1.5 + 0.15 * towerSize) * Math.PI) / 180);
  return amplitude * Math.exp(-3 * local) * Math.sin(14 * local);
}

/** Squash & stretch on landing: [xzScale, yScale]. Volume-preserving, settles in ~0.5 s. */
export function landingScale(t: number): [number, number] {
  if (t < 0 || t > 0.6) return [1, 1];
  const y = 1 - 0.2 * Math.exp(-9 * t) * Math.cos(22 * t);
  return [1 / Math.sqrt(y), y];
}

/** Point on a parabolic arc from `from` to `to` at progress `p`, lifted by `arc` at the middle. */
export function arcPoint(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  p: number,
  arc: number,
): [number, number, number] {
  const lift = 4 * arc * p * (1 - p);
  return [from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p + lift, from[2] + (to[2] - from[2]) * p];
}

/** Badge flip angle around Y over 0.6 s (one full turn, eased). */
export const flipAngle = (t: number) => (t <= 0 || t > 0.6 ? 0 : easeInOutSine(t / 0.6) * Math.PI * 2);

/** Gentle resting sway: nothing below 8 cups, growing with height up to ~1.2°. */
export function idleSwayAngle(t: number, towerSize: number, phase: number): number {
  if (towerSize < 8) return 0;
  const amp = (Math.min(1.2, 0.04 * (towerSize - 7)) * Math.PI) / 180;
  return amp * Math.sin(t * 0.9 + phase);
}

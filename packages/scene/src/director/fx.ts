import type { Matrix4 } from 'three';

export type Vec3 = [number, number, number];

export interface Flyer {
  id: string;
  kind: 'bill' | 'cup';
  color: string;
  from: Vec3;
  to: Vec3;
  /** Peak height of the arc above the straight line. */
  arc: number;
  t0: number;
  duration: number;
}

export type BurstKind = 'smoke' | 'splash' | 'sparkle' | 'gold' | 'stamp' | 'petals';

export interface Burst {
  id: string;
  kind: BurstKind;
  pos: Vec3;
  t0: number;
  seed: number;
}

export interface Leaving {
  cupId: string;
  matrix: Matrix4;
  color: string;
  style: 'evaporate' | 'gold' | 'ascend';
  t0: number;
  duration: number;
  /** Ascending cups fly here (a recipient's pedestal). */
  to?: Vec3;
}

export type ReaperAction = 'stamp' | 'pen' | 'gavel' | 'reject' | 'tear' | 'inspect' | 'nod';

/**
 * Mutable, per-scene animation state. Written by timeline cues, read every frame by the visual components.
 * Nothing here is domain state: dropping it all (skip) leaves the scene showing the model as-is.
 */
export interface FxState {
  /** Scene clock (seconds), updated each frame. */
  now: number;
  /** Cups whose drop finished; they now appear in the stack. */
  landed: Set<string>;
  /** Cup id → landing time, for squash & stretch. */
  landings: Map<string, number>;
  /** Tower id → impact time, for the wobble that travels up the stack. */
  impacts: Map<string, number>;
  /** Cups whose removal animation has started or finished (no longer drawn as static ghosts). */
  removalStarted: Set<string>;
  flyers: Map<string, Flyer>;
  bursts: Burst[];
  leaving: Map<string, Leaving>;
  /** Tower id → grade badge flip start. */
  flips: Map<string, number>;
  reaper: { action: ReaperAction; t0: number } | null;
  /** Camera focus requested by the running animation (overrides the user's focus while set). */
  focus: string | null;
}

export const createFx = (): FxState => ({
  now: 0,
  landed: new Set(),
  landings: new Map(),
  impacts: new Map(),
  removalStarted: new Set(),
  flyers: new Map(),
  bursts: [],
  leaving: new Map(),
  flips: new Map(),
  reaper: null,
  focus: null,
});

/** Clears transient effects after a skip; landed/removed bookkeeping is kept so the stack stays final. */
export function clearTransient(fx: FxState) {
  fx.flyers.clear();
  fx.bursts = [];
  fx.leaving.clear();
  fx.impacts.clear();
  fx.landings.clear();
  fx.flips.clear();
  fx.reaper = null;
  fx.focus = null;
}

/** True while anything still needs frames. */
export function fxBusy(fx: FxState, settle = 2.5): boolean {
  const recent = (t: number) => fx.now - t < settle;
  return (
    fx.flyers.size > 0 ||
    fx.leaving.size > 0 ||
    fx.bursts.some((b) => recent(b.t0)) ||
    [...fx.impacts.values()].some(recent) ||
    [...fx.landings.values()].some(recent) ||
    [...fx.flips.values()].some(recent) ||
    (fx.reaper !== null && recent(fx.reaper.t0))
  );
}

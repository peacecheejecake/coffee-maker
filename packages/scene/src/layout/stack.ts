import type { CupView } from '../model';
import { hashString, seededRandom } from '../random';
import { CARRIER_BOX, PEDESTAL, STACK_STEP } from './dimensions';

export interface StackJitter {
  rotationY: number;
  offsetX: number;
  offsetZ: number;
  tilt: number;
}

export type StackItem =
  | { kind: 'cup'; id: string; cup: CupView; y: number; jitter: StackJitter }
  | { kind: 'box'; id: string; cups: number; y: number; jitter: StackJitter };

export interface StackOptions {
  /** Start compressing once a tower has more cups than this. */
  compressAbove: number;
  /** Keep at least this many individual cups on top when compressing. */
  keepTop: number;
}

export const DEFAULT_STACK: StackOptions = { compressAbove: 20, keepTop: 10 };

/** Deterministic "stacked by hand" wobble derived from the item id. */
export function jitterFor(id: string): StackJitter {
  const rnd = seededRandom(hashString(id));
  const spread = (max: number) => (rnd() * 2 - 1) * max;
  return {
    rotationY: spread(0.07),
    offsetX: spread(0.03),
    offsetZ: spread(0.03),
    tilt: spread(0.02),
  };
}

/**
 * Lays out a tower bottom→top in tower-local space (y = 0 is the floor).
 * Past `compressAbove` cups, the oldest cups collapse into carrier boxes of ten so towers stay readable.
 */
export function stackItems(
  cups: readonly CupView[],
  opts: StackOptions = DEFAULT_STACK,
): { items: StackItem[]; height: number } {
  const boxes = cups.length > opts.compressAbove ? Math.floor((cups.length - opts.keepTop) / CARRIER_BOX.cups) : 0;
  const boxed = boxes * CARRIER_BOX.cups;
  const items: StackItem[] = [];
  let y = PEDESTAL.height;

  for (let b = 0; b < boxes; b++) {
    const first = cups[b * CARRIER_BOX.cups];
    const id = `box:${first?.id ?? b}`;
    items.push({ kind: 'box', id, cups: CARRIER_BOX.cups, y, jitter: jitterFor(id) });
    y += CARRIER_BOX.height;
  }
  for (const cup of cups.slice(boxed)) {
    items.push({ kind: 'cup', id: cup.id, cup, y, jitter: jitterFor(cup.id) });
    y += STACK_STEP;
  }
  return { items, height: y };
}

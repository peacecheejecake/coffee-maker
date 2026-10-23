import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, towerSlots } from '../src/layout/towerLayout';
import { stackItems, jitterFor } from '../src/layout/stack';
import { frameBounds, unionBounds, type Bounds } from '../src/layout/framing';
import { CARRIER_BOX, PEDESTAL, STACK_STEP } from '../src/layout/dimensions';
import { hashString } from '../src/random';

const cups = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, age: 'fresh' as const }));

describe('towerSlots', () => {
  it('is empty for no towers', () => {
    expect(towerSlots(0)).toEqual([]);
  });

  it.each([1, 2, 3, 6, 7])('%i towers: one row, symmetric-ish, centre gap kept, sorted left→right', (n) => {
    const slots = towerSlots(n);
    expect(slots).toHaveLength(n);
    expect(slots.every((s) => s.row === 0)).toBe(true);
    const xs = slots.map((s) => s.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(xs.every((x) => Math.abs(x) >= DEFAULT_LAYOUT.centerGap / 2 - 1e-9)).toBe(true);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.spacing - 1e-9);
  });

  it('splits into two rows past the front-row limit, back row raised and behind', () => {
    const slots = towerSlots(9);
    expect(slots.filter((s) => s.row === 0)).toHaveLength(5);
    const back = slots.filter((s) => s.row === 1);
    expect(back).toHaveLength(4);
    expect(back.every((s) => s.y === DEFAULT_LAYOUT.rowRise && s.z < -DEFAULT_LAYOUT.rowDepth + 1e-9)).toBe(true);
  });

  it('edge towers bend back and turn toward the centre', () => {
    const slots = towerSlots(6);
    const left = slots[0]!;
    const right = slots[5]!;
    expect(left.z).toBeLessThan(0);
    expect(left.rotationY).toBeGreaterThan(0);
    expect(right.rotationY).toBeLessThan(0);
    expect(left.z).toBeCloseTo(right.z);
  });
});

describe('stackItems', () => {
  it('stacks cups from the pedestal top', () => {
    const { items, height } = stackItems(cups(3));
    expect(items.map((i) => i.kind)).toEqual(['cup', 'cup', 'cup']);
    expect(items[0]!.y).toBe(PEDESTAL.height);
    expect(items[2]!.y).toBeCloseTo(PEDESTAL.height + 2 * STACK_STEP);
    expect(height).toBeCloseTo(PEDESTAL.height + 3 * STACK_STEP);
  });

  it('does not compress at 20', () => {
    expect(stackItems(cups(20)).items.every((i) => i.kind === 'cup')).toBe(true);
  });

  it.each([
    [21, 1, 11],
    [34, 2, 14],
    [100, 9, 10],
  ])('%i cups → %i boxes + %i cups, oldest boxed first', (n, boxes, loose) => {
    const { items, height } = stackItems(cups(n));
    expect(items.filter((i) => i.kind === 'box')).toHaveLength(boxes);
    expect(items.filter((i) => i.kind === 'cup')).toHaveLength(loose);
    expect(items[0]!.kind).toBe('box');
    expect(items[boxes]!.id).toBe(`c${boxes * CARRIER_BOX.cups}`);
    expect(height).toBeCloseTo(PEDESTAL.height + boxes * CARRIER_BOX.height + loose * STACK_STEP);
  });

  it('jitter is deterministic and small', () => {
    expect(jitterFor('abc')).toEqual(jitterFor('abc'));
    expect(jitterFor('abc')).not.toEqual(jitterFor('abd'));
    expect(Math.abs(jitterFor('x').rotationY)).toBeLessThanOrEqual(0.07);
    expect(hashString('')).toBe(0x811c9dc5);
  });
});

describe('frameBounds', () => {
  const box: Bounds = { min: [-5, 0, -3], max: [5, 4, 1] };
  const base = { fovY: 35, pitch: 15, margin: 0.08, minDistance: 4 };

  /** Projects a point into normalised device coordinates for the framed camera. */
  function ndc(p: [number, number, number], aspect: number) {
    const f = frameBounds(box, { ...base, aspect });
    const pitch = (base.pitch * Math.PI) / 180;
    const rel = [p[0] - f.position[0], p[1] - f.position[1], p[2] - f.position[2]] as const;
    const fwd = [0, -Math.sin(pitch), -Math.cos(pitch)];
    const up = [0, Math.cos(pitch), -Math.sin(pitch)];
    const depth = rel[1] * fwd[1]! + rel[2] * fwd[2]!;
    const tan = Math.tan((base.fovY * Math.PI) / 360);
    return { x: rel[0] / (depth * tan * aspect), y: (rel[1] * up[1]! + rel[2] * up[2]!) / (depth * tan) };
  }

  it.each([16 / 9, 9 / 19.5])('every corner lands inside the margins (aspect %f)', (aspect) => {
    for (const x of [box.min[0], box.max[0]])
      for (const y of [box.min[1], box.max[1]])
        for (const z of [box.min[2], box.max[2]]) {
          const p = ndc([x, y, z], aspect);
          expect(Math.abs(p.x)).toBeLessThanOrEqual(1 - 2 * base.margin + 1e-6);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(1 - 2 * base.margin + 1e-6);
        }
  });

  it('portrait screens need a more distant camera', () => {
    const wide = frameBounds(box, { ...base, aspect: 16 / 9 });
    const tall = frameBounds(box, { ...base, aspect: 9 / 19.5 });
    expect(tall.position[2]).toBeGreaterThan(wide.position[2]);
  });

  it('respects the minimum distance', () => {
    const tiny: Bounds = { min: [0, 0, 0], max: [0.1, 0.1, 0.1] };
    const f = frameBounds(tiny, { ...base, aspect: 1 });
    const d = Math.hypot(f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2]);
    expect(d).toBeCloseTo(base.minDistance);
  });

  it('caps very tall bounds to what the width can show, keeping the floor', () => {
    const tall: Bounds = { min: [-5, 0, -3], max: [5, 40, 1] };
    const capped = frameBounds(tall, { ...base, aspect: 2, maxHeightFactor: 1.2 });
    const reference = frameBounds({ min: [-5, 0, -3], max: [5, 6, 1] }, { ...base, aspect: 2 });
    expect(capped).toEqual(reference);
    // Portrait has room for height, so the same cap lets much more through.
    const portrait = frameBounds(tall, { ...base, aspect: 0.5, maxHeightFactor: 1.2 });
    expect(portrait.target[1]).toBeCloseTo(12);
    // Short bounds are untouched.
    expect(frameBounds(box, { ...base, aspect: 2, maxHeightFactor: 1.2 })).toEqual(frameBounds(box, { ...base, aspect: 2 }));
  });

  it('unions bounds', () => {
    expect(unionBounds(box, { min: [-6, 1, 0], max: [0, 9, 2] })).toEqual({ min: [-6, 0, -3], max: [5, 9, 2] });
  });
});

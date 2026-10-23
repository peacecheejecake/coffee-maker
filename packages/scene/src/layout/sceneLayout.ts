import type { TowerView } from '../model';
import { DESK, PEDESTAL } from './dimensions';
import type { Bounds } from './framing';
import { stackItems, type StackItem } from './stack';
import { towerSlots, type TowerSlot } from './towerLayout';

export interface PlacedTower {
  tower: TowerView;
  slot: TowerSlot;
  items: StackItem[];
  /** Stack height in tower-local space. */
  height: number;
}

export function placeTowers(towers: readonly TowerView[]): PlacedTower[] {
  const slots = towerSlots(towers.length);
  return towers.map((tower, i) => {
    const { items, height } = stackItems(tower.cups);
    return { tower, slot: slots[i]!, items, height };
  });
}

const HALF_WIDTH = PEDESTAL.radius + 0.1;
/** Room in front of each pedestal for the nameplate. */
const FRONT = 1.0;

export function towerBounds(t: PlacedTower): Bounds {
  const { x, y, z } = t.slot;
  return {
    min: [x - HALF_WIDTH, y, z - HALF_WIDTH],
    max: [x + HALF_WIDTH, y + t.height + 0.2, z + FRONT],
  };
}

export const deskBounds = (): Bounds => {
  const [x, , z] = DESK.position;
  return {
    min: [x - DESK.width / 2, 0, z - DESK.depth],
    max: [x + DESK.width / 2, DESK.topY, z + DESK.depth / 2],
  };
};

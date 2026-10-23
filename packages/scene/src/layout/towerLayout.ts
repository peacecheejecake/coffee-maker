export interface TowerSlot {
  x: number;
  y: number;
  z: number;
  /** Rotation around Y so the tower faces the viewer along the curved row. */
  rotationY: number;
  row: 0 | 1;
}

export interface LayoutOptions {
  /** Distance between neighbouring towers in a row. */
  spacing: number;
  /** Free space in the middle of each row so the reaper's desk stays visible. */
  centerGap: number;
  /** z = -curvature · x²: rows bend away from the viewer at the edges. */
  curvature: number;
  /** Rows beyond this count split into a front and a raised back row. */
  maxFrontRow: number;
  rowDepth: number;
  rowRise: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  spacing: 1.9,
  centerGap: 2.6,
  curvature: 0.03,
  maxFrontRow: 7,
  rowDepth: 2.4,
  rowRise: 0.6,
};

/** Slots for `n` towers, in player order (front row left→right, then back row left→right). */
export function towerSlots(n: number, opts: LayoutOptions = DEFAULT_LAYOUT): TowerSlot[] {
  if (n <= 0) return [];
  const rows: number[] = n <= opts.maxFrontRow ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
  return rows.flatMap((count, row) => rowSlots(count, row as 0 | 1, opts));
}

function rowSlots(count: number, row: 0 | 1, o: LayoutOptions): TowerSlot[] {
  // Back row is staggered half a step outward so its towers show between the front ones.
  const stagger = row === 1 ? o.spacing / 2 : 0;
  const left = Math.ceil(count / 2);
  const right = count - left;
  const xs = [
    ...Array.from({ length: left }, (_, i) => -(o.centerGap / 2 + stagger + i * o.spacing)).reverse(),
    ...Array.from({ length: right }, (_, i) => o.centerGap / 2 + stagger + i * o.spacing),
  ];
  return xs.map((x) => ({
    x,
    y: row * o.rowRise,
    z: -o.curvature * x * x - row * o.rowDepth,
    rotationY: -Math.atan(2 * o.curvature * x),
    row,
  }));
}

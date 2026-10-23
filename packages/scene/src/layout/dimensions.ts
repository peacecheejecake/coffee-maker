/** World units: 1 ≈ one takeaway cup's height. */
export const CUP = {
  height: 1,
  lidHeight: 0.12,
  bottomRadius: 0.31,
  topRadius: 0.42,
} as const;

/** Vertical distance between stacked cups (slight overlap where the next cup sits on the lid). */
export const STACK_STEP = CUP.height + CUP.lidHeight - 0.02;

export const CARRIER_BOX = { height: 1.3, width: 1.05, cups: 10 } as const;

export const PEDESTAL = { height: 0.3, radius: 0.62 } as const;

export const DESK = {
  position: [0, 0, -2.1] as const,
  width: 2.2,
  depth: 1.1,
  height: 0.9,
  /** Top of the seated reaper's hood, for framing. */
  topY: 2.3,
};

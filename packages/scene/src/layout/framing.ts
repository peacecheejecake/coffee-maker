export type Vec3 = [number, number, number];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface FramingOptions {
  /** Vertical field of view in degrees. */
  fovY: number;
  /** width / height */
  aspect: number;
  /** Camera elevation in degrees (positive = looking down). */
  pitch: number;
  /** Fraction of the viewport kept free on each side. */
  margin: number;
  minDistance: number;
  /**
   * Caps the framed height at `factor × width / aspect` (keeping the bottom), so one absurdly tall tower
   * does not shrink everything else; it simply runs off the top of the screen.
   */
  maxHeightFactor?: number;
}

export interface Framing {
  position: Vec3;
  target: Vec3;
}

export const unionBounds = (a: Bounds, b: Bounds): Bounds => ({
  min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
  max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
});

/**
 * Places a perspective camera on the +z side, looking down by `pitch`, at the smallest distance at which
 * every corner of `bounds` falls inside the frustum (minus margins). Pure, so it can be unit tested.
 */
export function frameBounds(input: Bounds, o: FramingOptions): Framing {
  const bounds = o.maxHeightFactor === undefined ? input : capHeight(input, o.maxHeightFactor, o.aspect);
  const target: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const pitch = (o.pitch * Math.PI) / 180;
  // Unit vector from target towards the camera, and the camera's up axis.
  const back: Vec3 = [0, Math.sin(pitch), Math.cos(pitch)];
  const up: Vec3 = [0, Math.cos(pitch), -Math.sin(pitch)];
  const tanV = Math.tan((o.fovY * Math.PI) / 360) * (1 - 2 * o.margin);
  const tanH = Math.tan((o.fovY * Math.PI) / 360) * o.aspect * (1 - 2 * o.margin);

  let distance = o.minDistance;
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const p: Vec3 = [x - target[0], y - target[1], z - target[2]];
        const along = dot(p, back); // how much closer to the camera this corner is than the target
        distance = Math.max(distance, along + Math.abs(p[0]) / tanH, along + Math.abs(dot(p, up)) / tanV);
      }
    }
  }
  return {
    target,
    position: [target[0] + back[0] * distance, target[1] + back[1] * distance, target[2] + back[2] * distance],
  };
}

function capHeight(b: Bounds, factor: number, aspect: number): Bounds {
  const maxHeight = ((b.max[0] - b.min[0]) / aspect) * factor;
  if (b.max[1] - b.min[1] <= maxHeight) return b;
  return { min: b.min, max: [b.max[0], b.min[1] + maxHeight, b.max[2]] };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

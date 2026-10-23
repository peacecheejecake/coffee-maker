import type { BufferGeometry} from 'three';
import { LatheGeometry, Vector2 } from 'three';
import { CUP } from '../layout/dimensions';

const SEGMENTS = 24;
const v = (r: number, y: number) => new Vector2(r, y);

/** Body radius at height y (straight taper between the rounded bottom and the rim). */
const bodyRadius = (y: number) => CUP.bottomRadius + ((CUP.topRadius - 0.02 - CUP.bottomRadius) * (y - 0.04)) / 0.9;

function body(): BufferGeometry {
  return new LatheGeometry(
    [
      v(0, 0),
      v(CUP.bottomRadius - 0.04, 0),
      v(CUP.bottomRadius - 0.01, 0.012),
      v(CUP.bottomRadius, 0.04),
      v(bodyRadius(0.94), 0.94),
      v(CUP.topRadius - 0.005, 0.97),
      v(CUP.topRadius, CUP.height),
    ],
    SEGMENTS,
  );
}

function lid(): BufferGeometry {
  const r = CUP.topRadius + 0.025;
  return new LatheGeometry(
    [
      v(r - 0.03, CUP.height - 0.01),
      v(r, CUP.height + 0.01),
      v(r, CUP.height + 0.045),
      v(r - 0.03, CUP.height + 0.07),
      v(r - 0.12, CUP.height + 0.09),
      v(r - 0.2, CUP.height + 0.11),
      v(0, CUP.height + CUP.lidHeight),
    ],
    SEGMENTS,
  );
}

function sleeve(): BufferGeometry {
  const lo = 0.3;
  const hi = 0.68;
  const t = 0.014;
  return new LatheGeometry(
    [v(bodyRadius(lo), lo - 0.005), v(bodyRadius(lo) + t, lo), v(bodyRadius(hi) + t, hi), v(bodyRadius(hi), hi + 0.005)],
    SEGMENTS,
  );
}

export interface CupGeometries {
  body: BufferGeometry;
  lid: BufferGeometry;
  sleeve: BufferGeometry;
}

let cached: CupGeometries | undefined;

/** Shared by every cup instance; created once. */
export function cupGeometries(): CupGeometries {
  cached ??= { body: body(), lid: lid(), sleeve: sleeve() };
  return cached;
}

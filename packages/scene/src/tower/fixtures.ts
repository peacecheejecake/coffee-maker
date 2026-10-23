import { BoxGeometry, CanvasTexture, CylinderGeometry, LatheGeometry, SRGBColorSpace, TorusGeometry, Vector2 } from 'three';
import { CARRIER_BOX, PEDESTAL } from '../layout/dimensions';
import { PALETTE } from '../palette';

/** Where the nameplate sits relative to the tower origin, and its tilt. */
export const PLAQUE = { size: [1.25, 0.32, 0.06] as const, y: 0.17, z: PEDESTAL.radius + 0.12, tilt: -0.12 };
export const BADGE = { x: 0.43, radius: 0.12 };

let cache:
  | { pedestal: LatheGeometry; ring: TorusGeometry; plaque: BoxGeometry; badge: CylinderGeometry; box: BoxGeometry }
  | undefined;

export function fixtureGeometries() {
  cache ??= {
    pedestal: new LatheGeometry(
      [
        new Vector2(0, 0),
        new Vector2(PEDESTAL.radius + 0.04, 0),
        new Vector2(PEDESTAL.radius + 0.05, 0.03),
        new Vector2(PEDESTAL.radius, PEDESTAL.height - 0.05),
        new Vector2(PEDESTAL.radius - 0.05, PEDESTAL.height),
        new Vector2(0, PEDESTAL.height),
      ],
      32,
    ),
    ring: new TorusGeometry(PEDESTAL.radius - 0.06, 0.025, 8, 40),
    plaque: new BoxGeometry(...PLAQUE.size),
    badge: new CylinderGeometry(BADGE.radius, BADGE.radius, 0.02, 24),
    box: new BoxGeometry(CARRIER_BOX.width, CARRIER_BOX.height - 0.02, CARRIER_BOX.width),
  };
  return cache;
}

let label: CanvasTexture | undefined;

/** Kraft texture with "×10" printed on it; shared by every carrier box face. */
export function carrierLabelTexture(): CanvasTexture {
  if (label) return label;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = PALETTE.carrierBox;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(74, 48, 32, 0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, 228, 228);
    ctx.fillStyle = PALETTE.carrierLabel;
    ctx.font = `700 96px Pretendard, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`×${CARRIER_BOX.cups}`, 128, 136);
  }
  label = new CanvasTexture(canvas);
  label.colorSpace = SRGBColorSpace;
  label.anisotropy = 4;
  return label;
}

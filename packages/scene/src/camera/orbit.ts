import type { Vec3 } from '../layout/framing';

/** The user's adjustments on top of the automatic framing: drag to orbit, wheel / pinch / buttons to zoom. */
export interface UserView {
  /** Radians around the vertical axis through the framed target (0 = straight on). */
  yaw: number;
  /** Radians added to the framing's downward tilt. */
  pitch: number;
  /** Multiplies the framing distance (< 1 is closer). */
  zoom: number;
}

export const DEFAULT_VIEW: UserView = { yaw: 0, pitch: 0, zoom: 1 };
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2.5;
/** Absolute camera elevation limits: never under the floor, never straight down. */
export const ELEVATION_MIN = (3 * Math.PI) / 180;
export const ELEVATION_MAX = (70 * Math.PI) / 180;
/** Pointer travel (px) after which a press counts as a drag rather than a tap. */
export const DRAG_THRESHOLD = 6;

/** Keeps the zoom and the resulting elevation (`basePitch + pitch`) within limits. */
export function clampView(view: UserView, basePitch: number): UserView {
  return {
    yaw: view.yaw,
    pitch: Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, basePitch + view.pitch)) - basePitch,
    zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom)),
  };
}

/** Camera position `distance` away from `target`, raised by `elevation` and turned by `yaw` (0 = on +z). */
export function orbitPosition(target: Vec3, distance: number, elevation: number, yaw: number): Vec3 {
  const flat = distance * Math.cos(elevation);
  return [target[0] + flat * Math.sin(yaw), target[1] + distance * Math.sin(elevation), target[2] + flat * Math.cos(yaw)];
}

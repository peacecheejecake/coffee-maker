import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { Vector3, type PerspectiveCamera } from 'three';
import { frameBounds, type Bounds } from '../layout/framing';
import { clampView, DEFAULT_VIEW, orbitPosition, type UserView } from './orbit';

/** Lets the page orbit and zoom the camera (drag, wheel, buttons) on top of the automatic framing. */
export interface CameraHandle {
  /** Multiplies the distance (> 1 zooms out). */
  zoomBy(factor: number): void;
  /** Turns the view by the given radians (yaw around the vertical axis, pitch up/down). */
  orbitBy(yaw: number, pitch: number): void;
}

interface CameraRigProps {
  bounds: Bounds;
  /** Degrees of downward tilt. */
  pitch?: number;
  margin?: number;
  /** See FramingOptions.maxHeightFactor. Omit to always fit the full height (e.g. when focused). */
  maxHeightFactor?: number;
  /** Higher = snappier. Exponential smoothing rate per second. */
  stiffness?: number;
  handle?: Ref<CameraHandle>;
}

/** Smoothing rate for the user's own orbit/zoom: quick enough to feel attached to the pointer. */
const USER_STIFFNESS = 14;

/** Eases the camera to frame `bounds`. Works with frameloop="demand": keeps invalidating only while moving. */
export function CameraRig({ bounds, pitch = 14, margin = 0.08, maxHeightFactor, stiffness = 4, handle }: CameraRigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const elevation = (pitch * Math.PI) / 180;

  const goal = useMemo(() => {
    const f = frameBounds(bounds, {
      fovY: camera.fov,
      aspect: size.width / Math.max(1, size.height),
      pitch,
      margin,
      minDistance: 5,
      ...(maxHeightFactor !== undefined && { maxHeightFactor }),
    });
    const target = new Vector3(...f.target);
    return { target, distance: new Vector3(...f.position).distanceTo(target) };
  }, [bounds, camera.fov, size.width, size.height, pitch, margin, maxHeightFactor]);

  // Where the camera is now (smoothed towards `goal` and `view`).
  const current = useRef<{ target: Vector3; distance: number; view: UserView } | null>(null);
  const view = useRef<UserView>(DEFAULT_VIEW);

  useImperativeHandle(
    handle,
    () => ({
      zoomBy: (factor) => {
        view.current = clampView({ ...view.current, zoom: view.current.zoom * factor }, elevation);
        invalidate();
      },
      orbitBy: (yaw, dPitch) => {
        view.current = clampView({ ...view.current, yaw: view.current.yaw + yaw, pitch: view.current.pitch + dPitch }, elevation);
        invalidate();
      },
    }),
    [elevation, invalidate],
  );

  const place = () => {
    const c = current.current!;
    const t = c.target;
    camera.position.set(...orbitPosition([t.x, t.y, t.z], c.distance * c.view.zoom, elevation + c.view.pitch, c.view.yaw));
    camera.lookAt(t);
  };

  useEffect(() => {
    if (!current.current) {
      // First framing: jump instead of flying in from the default camera position.
      current.current = { target: goal.target.clone(), distance: goal.distance, view: { ...view.current } };
      place();
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, camera, invalidate]);

  useFrame((_, delta) => {
    const c = current.current;
    if (!c) return;
    const dt = Math.min(delta, 1 / 30);
    const k = 1 - Math.exp(-dt * stiffness);
    const ku = 1 - Math.exp(-dt * USER_STIFFNESS);
    const v = view.current;
    c.target.lerp(goal.target, k);
    c.distance += (goal.distance - c.distance) * k;
    c.view = {
      yaw: c.view.yaw + (v.yaw - c.view.yaw) * ku,
      pitch: c.view.pitch + (v.pitch - c.view.pitch) * ku,
      zoom: c.view.zoom + (v.zoom - c.view.zoom) * ku,
    };
    place();
    const moving =
      c.target.distanceToSquared(goal.target) > 1e-6 ||
      Math.abs(c.distance - goal.distance) > 1e-3 ||
      Math.abs(c.view.yaw - v.yaw) > 1e-4 ||
      Math.abs(c.view.pitch - v.pitch) > 1e-4 ||
      Math.abs(c.view.zoom - v.zoom) > 1e-4;
    if (moving) invalidate();
  });

  return null;
}

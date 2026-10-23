import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Vector3, type PerspectiveCamera } from 'three';
import { frameBounds, type Bounds } from '../layout/framing';

interface CameraRigProps {
  bounds: Bounds;
  /** Degrees of downward tilt. */
  pitch?: number;
  margin?: number;
  /** See FramingOptions.maxHeightFactor. Omit to always fit the full height (e.g. when focused). */
  maxHeightFactor?: number;
  /** Higher = snappier. Exponential smoothing rate per second. */
  stiffness?: number;
}

/** Eases the camera to frame `bounds`. Works with frameloop="demand": keeps invalidating only while moving. */
export function CameraRig({ bounds, pitch = 14, margin = 0.08, maxHeightFactor, stiffness = 4 }: CameraRigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  const goal = useMemo(() => {
    const f = frameBounds(bounds, {
      fovY: camera.fov,
      aspect: size.width / Math.max(1, size.height),
      pitch,
      margin,
      minDistance: 5,
      ...(maxHeightFactor !== undefined && { maxHeightFactor }),
    });
    return { position: new Vector3(...f.position), target: new Vector3(...f.target) };
  }, [bounds, camera.fov, size.width, size.height, pitch, margin, maxHeightFactor]);

  const lookAt = useRef<Vector3 | null>(null);

  useEffect(() => {
    if (!lookAt.current) {
      // First framing: jump instead of flying in from the default camera position.
      camera.position.copy(goal.position);
      lookAt.current = goal.target.clone();
      camera.lookAt(lookAt.current);
    }
    invalidate();
  }, [goal, camera, invalidate]);

  useFrame((_, delta) => {
    const target = lookAt.current;
    if (!target) return;
    const k = 1 - Math.exp(-Math.min(delta, 1 / 30) * stiffness);
    camera.position.lerp(goal.position, k);
    target.lerp(goal.target, k);
    camera.lookAt(target);
    if (camera.position.distanceToSquared(goal.position) > 1e-6 || target.distanceToSquared(goal.target) > 1e-6) {
      invalidate();
    }
  });

  return null;
}

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { CameraRig } from './camera/CameraRig';
import { CupInstances } from './cups/CupInstances';
import { Floor, Lighting } from './environment/Environment';
import { unionBounds } from './layout/framing';
import { deskBounds, placeTowers, towerBounds } from './layout/sceneLayout';
import type { SceneModel } from './model';
import { ReaperDesk } from './reaper/ReaperDesk';
import { Tower } from './tower/Tower';
import { TowerFixtures } from './tower/TowerFixtures';

export interface TowerSceneProps {
  model: SceneModel;
  /** woff/ttf/otf URL for 3D text (troika cannot use CSS fonts). */
  fontUrl: string;
  onSelectTower?: (id: string | null) => void;
  /** "demand" (default) renders only when something changes; "always" for profiling. */
  frameloop?: 'demand' | 'always';
  /** Extra scene children, e.g. dev probes. */
  children?: ReactNode;
}

const isCoarsePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export function TowerScene({ model, fontUrl, onSelectTower, frameloop = 'demand', children }: TowerSceneProps) {
  const placed = useMemo(() => placeTowers(model.towers), [model.towers]);

  // Contact shadows only depend on what stands on the floor; re-render them when that changes, not every frame.
  const shadowKey = useMemo(() => placed.map((p) => `${p.slot.x.toFixed(2)}:${p.height.toFixed(2)}`).join('|'), [placed]);

  const bounds = useMemo(() => {
    const focused = placed.find((p) => p.tower.id === model.focusId);
    if (focused) return towerBounds(focused);
    return placed.map(towerBounds).reduce(unionBounds, deskBounds());
  }, [placed, model.focusId]);

  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, isCoarsePointer() ? 1.5 : 2]}
      camera={{ fov: 35, near: 0.1, far: 300, position: [0, 6, 20] }}
      gl={{ alpha: true, antialias: true }}
      onPointerMissed={() => onSelectTower?.(null)}
    >
      <Lighting />
      <Floor shadowKey={shadowKey} />
      <ReaperDesk />
      <CupInstances towers={placed} />
      <TowerFixtures towers={placed} />
      {placed.map((p) => (
        <Tower key={p.tower.id} placed={p} fontUrl={fontUrl} {...(onSelectTower && { onSelect: onSelectTower })} />
      ))}
      <CameraRig
        bounds={bounds}
        margin={model.focusId ? 0.12 : 0.06}
        {...(!model.focusId && { maxHeightFactor: 1.15 })}
      />
      {children}
    </Canvas>
  );
}

export interface RenderStats {
  fps: number;
  drawCalls: number;
  triangles: number;
}

/** Dev probe: reports fps and per-frame renderer totals (all passes) every half second. Use with frameloop="always". */
export function RenderProbe({ onSample }: { onSample: (s: RenderStats) => void }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, time: 0 });
  useEffect(() => {
    // Accumulate every pass of a frame (ContactShadows renders its own pass), reset once per frame below.
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame((_, delta) => {
    acc.current.frames++;
    acc.current.time += delta;
    if (acc.current.time >= 0.5) {
      onSample({
        fps: Math.round(acc.current.frames / acc.current.time),
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      });
      acc.current = { frames: 0, time: 0 };
    }
    gl.info.reset();
  });
  return null;
}

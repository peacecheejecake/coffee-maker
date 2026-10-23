import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Matrix4 } from 'three';
import { CameraRig } from './camera/CameraRig';
import { CupInstances, restingMatrices } from './cups/CupInstances';
import type { DirectorEnv } from './director/director';
import { createFx, type FxState, type Leaving } from './director/fx';
import { FxLayer } from './director/FxLayer';
import { Runner, type RunnerHandle } from './director/Runner';
import { Floor, Lighting } from './environment/Environment';
import { DESK, PEDESTAL } from './layout/dimensions';
import { unionBounds } from './layout/framing';
import { deskBounds, placeTowers, towerBounds } from './layout/sceneLayout';
import type { SceneEvent, SceneModel } from './model';
import { ReaperDesk } from './reaper/ReaperDesk';
import { BallotPlaques } from './tower/BallotPlaques';
import { Tower } from './tower/Tower';
import { TowerFixtures } from './tower/TowerFixtures';

export interface TowerSceneProps {
  model: SceneModel;
  /** woff/ttf/otf URL for 3D text (troika cannot use CSS fonts). */
  fontUrl: string;
  onSelectTower?: (id: string | null) => void;
  /** Things that just happened, oldest first. The model already shows the result; these animate it. */
  events?: readonly SceneEvent[];
  /** Called with ids whose animation finished (or was skipped); remove them from `events`. */
  onEventsConsumed?: (ids: string[]) => void;
  /** Fires while animations play / when they stop (e.g. for aria-busy). */
  onAnimatingChange?: (animating: boolean) => void;
  /** Sound cue names: stamp, whoosh, drop, gavel, sparkle. Audio itself is the app's business. */
  onSfx?: (name: string) => void;
  /** Defaults to the user's prefers-reduced-motion setting. */
  reducedMotion?: boolean;
  /** Animation speed multiplier (sandbox). */
  timeScale?: number;
  /** "demand" (default) renders only when something changes; "always" for profiling. */
  frameloop?: 'demand' | 'always';
  /** Extra scene children, e.g. dev probes. */
  children?: ReactNode;
}

const isCoarsePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const NO_EVENTS: readonly SceneEvent[] = [];

export function TowerScene({
  model,
  fontUrl,
  onSelectTower,
  events = NO_EVENTS,
  onEventsConsumed,
  onAnimatingChange,
  onSfx,
  reducedMotion,
  timeScale = 1,
  frameloop = 'demand',
  children,
}: TowerSceneProps) {
  const fx = useRef<FxState>(createFx());
  const runner = useRef<RunnerHandle>(null);
  const [fxFocus, setFxFocus] = useState<string | null>(null);
  const reduced = useMemo(() => reducedMotion ?? prefersReducedMotion(), [reducedMotion]);
  const suppressClick = useRef(false);

  const placed = useMemo(() => placeTowers(model.towers), [model.towers]);
  const resting = useMemo(() => restingMatrices(placed), [placed]);

  // Last place each cup was drawn, kept after it leaves the model so removals animate from there.
  const lastSeen = useRef(new Map<string, Matrix4>());
  useMemo(() => resting.forEach((m, id) => lastSeen.current.set(id, m)), [resting]);

  // Cups in the model whose drop has not finished yet, and cups that left the model but still show.
  const hidden = useMemo(
    () => new Set(events.flatMap((e) => (e.kind === 'cupsAdded' ? e.cupIds : []))),
    [events],
  );
  const ghosts = useRef<Leaving[]>([]);
  ghosts.current = useMemo(
    () =>
      events.flatMap((e) =>
        e.kind === 'cupsRemoved'
          ? e.cupIds.flatMap((cupId) => {
              const matrix = lastSeen.current.get(cupId);
              return matrix ? [{ cupId, matrix, color: '', style: e.style, t0: 0, duration: 0 }] : [];
            })
          : [],
      ),
    [events],
  );
  // Forget bookkeeping for cups no queued event refers to any more.
  useEffect(() => {
    const live = new Set(events.flatMap((e) => ('cupIds' in e ? e.cupIds : [])));
    for (const set of [fx.current.landed, fx.current.removalStarted]) for (const id of set) if (!live.has(id)) set.delete(id);
  }, [events]);

  const env = useMemo<DirectorEnv>(() => {
    const byId = new Map(placed.map((p) => [p.tower.id, p]));
    return {
      towerTop: (id) => {
        const p = byId.get(id);
        return p ? [p.slot.x, p.slot.y + p.height, p.slot.z] : [0, 3, 0];
      },
      towerBase: (id) => {
        const p = byId.get(id);
        return p ? [p.slot.x, p.slot.y + PEDESTAL.height, p.slot.z] : [0, 0, 0];
      },
      cupTarget: (id) => resting.get(id),
      cupLastSeen: (id) => lastSeen.current.get(id),
      towerColor: (id) => byId.get(id)?.tower.color ?? '#ccc',
      deskOut: [DESK.position[0], DESK.topY - 0.3, DESK.position[2] + 0.5],
      sfx: (name) => onSfx?.(name),
    };
  }, [placed, resting, onSfx]);

  const consume = useCallback((ids: string[]) => onEventsConsumed?.(ids), [onEventsConsumed]);

  const focusId = fxFocus ?? model.focusId;
  // Contact shadows only depend on what stands on the floor; re-render them when that changes, not every frame.
  const shadowKey = useMemo(() => placed.map((p) => `${p.slot.x.toFixed(2)}:${p.height.toFixed(2)}`).join('|'), [placed]);

  const bounds = useMemo(() => {
    const focused = placed.find((p) => p.tower.id === focusId);
    if (focused) return towerBounds(focused);
    return placed.map(towerBounds).reduce(unionBounds, deskBounds());
  }, [placed, focusId]);

  const select = useCallback(
    (id: string | null) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onSelectTower?.(id);
    },
    [onSelectTower],
  );

  return (
    // A tap while something animates skips to the end instead of selecting.
    <div
      style={{ position: 'absolute', inset: 0 }}
      onPointerDownCapture={() => {
        suppressClick.current = runner.current?.skip() ?? false;
      }}
    >
      <Canvas
        frameloop={frameloop}
        dpr={[1, isCoarsePointer() ? 1.5 : 2]}
        camera={{ fov: 35, near: 0.1, far: 300, position: [0, 6, 20] }}
        gl={{ alpha: true, antialias: true }}
        onPointerMissed={() => select(null)}
      >
        <Lighting />
        <Floor shadowKey={shadowKey} />
        <ReaperDesk fx={fx} />
        <CupInstances towers={placed} fx={fx} hidden={hidden} />
        <TowerFixtures towers={placed} fx={fx} />
        <BallotPlaques towers={placed} />
        {placed.map((p) => (
          <Tower key={p.tower.id} placed={p} fontUrl={fontUrl} onSelect={select} />
        ))}
        <FxLayer fx={fx} ghosts={ghosts} />
        <Runner
          events={events}
          onConsumed={consume}
          fx={fx}
          env={env}
          reduced={reduced}
          timeScale={timeScale}
          onFocus={setFxFocus}
          handle={runner}
        />
        {onAnimatingChange && <BusyReporter runner={runner} onChange={onAnimatingChange} />}
        <CameraRig
          bounds={bounds}
          margin={focusId ? 0.12 : 0.06}
          {...(!focusId && { maxHeightFactor: 1.15 })}
          stiffness={fxFocus ? 3 : 4}
        />
        {children}
      </Canvas>
    </div>
  );
}

function BusyReporter({ runner, onChange }: { runner: RefObject<RunnerHandle | null>; onChange: (busy: boolean) => void }) {
  const last = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [invalidate]);
  useFrame(() => {
    const busy = runner.current?.busy() ?? false;
    if (busy !== last.current) {
      last.current = busy;
      onChange(busy);
    }
  });
  return null;
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

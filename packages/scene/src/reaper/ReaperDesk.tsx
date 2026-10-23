import { Html, RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { BoxGeometry, LatheGeometry, Vector2, type Group } from 'three';
import type { FxState } from '../director/fx';
import { ModelBoundary, ReaperModel } from './ReaperModel';
import { StaticInstances, trs } from '../instancing/StaticInstances';
import { DESK } from '../layout/dimensions';
import { PALETTE } from '../palette';
import { hashString, seededRandom } from '../random';

/**
 * Placeholder reaper built from primitives (DESIGN.md §2.5): a chibi reaper in a hooded robe, chin on hand,
 * sitting behind a cream desk with paper stacks. Replaced by a rigged glb in M6 behind the same position.
 */
export type IdleAction = 'page' | 'yawn' | 'polish' | 'glance';

interface ReaperDeskProps {
  fx: RefObject<FxState>;
  /** Idle fidgets run only when the scene ticks idly (not for reduced motion). */
  idle?: boolean;
  /** 08:50–09:00: the reaper opens the roll and waits. */
  rollCall?: boolean;
  /** Angles (radians, around Y) toward towers worth a suspicious glance (grade B or worse). */
  glanceAt?: number[];
  /** Lines for the speech bubble when tapped. */
  lines?: string[];
  /** Rigged glb (scripts/blender/reaper.py). Without it, the primitive placeholder is used. */
  modelUrl?: string;
  onModelReady?: () => void;
}

export function ReaperDesk({ fx, idle = false, rollCall = false, glanceAt = [], lines = [], modelUrl, onModelReady }: ReaperDeskProps) {
  const desk = useRef<Group>(null);
  const idleState = useRef<{ action: IdleAction; t0: number; glance: number; next: number } | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  useEffect(() => {
    if (!bubble) return;
    const timer = setTimeout(() => setBubble(null), 3200);
    return () => clearTimeout(timer);
  }, [bubble]);
  const head = useRef<Group>(null);
  const stampArm = useRef<Group>(null);
  const penHand = useRef<Group>(null);
  const magnifier = useRef<Group>(null);

  useFrame(({ clock }) => {
    const action = fx.current?.reaper;
    const t = action ? fx.current!.now - action.t0 : Infinity;
    let pose = reaperPose(action?.action ?? null, t);
    // Between events: an occasional fidget every few seconds.
    if (pose === REST && idle) {
      const now = clock.elapsedTime;
      const s = idleState.current;
      if (!s || now > s.next) {
        const options: IdleAction[] = glanceAt.length ? ['page', 'yawn', 'polish', 'glance'] : ['page', 'yawn', 'polish'];
        const pick = options[Math.floor(Math.random() * options.length)]!;
        idleState.current = {
          action: pick,
          t0: now,
          glance: glanceAt[Math.floor(Math.random() * glanceAt.length)] ?? 0,
          next: now + 5 + Math.random() * 6,
        };
      }
      const cur = idleState.current!;
      pose = idlePose(cur.action, now - cur.t0, cur.glance);
      if (rollCall) pose = { ...pose, headX: 0.28, penX: Math.sin(now * 2) * 0.03 };
    }
    stampArm.current?.rotation.set(pose.armX, 0, -0.5);
    if (magnifier.current) magnifier.current.visible = pose.magnifier;
    if (penHand.current) penHand.current.position.set(-0.3 + pose.penX, 1.0, 0.72 + pose.penZ);
    head.current?.rotation.set(0.08 + pose.headX, pose.headY, -0.1);
    if (desk.current) desk.current.position.y = pose.deskY;
  });

  return (
    <group position={[...DESK.position]}>
      <group
        onClick={(e) => {
          e.stopPropagation();
          if (lines.length) setBubble(lines[Math.floor(Math.random() * lines.length)]!);
        }}
      >
        {modelUrl ? (
          <ModelBoundary fallback={<Reaper head={head} stampArm={stampArm} penHand={penHand} magnifier={magnifier} />}>
            <Suspense fallback={<Reaper head={head} stampArm={stampArm} penHand={penHand} magnifier={magnifier} />}>
              <group position={[0, 0.25, -0.35]}>
                <ReaperModel url={modelUrl} fx={fx} idle={idle} rollCall={rollCall} {...(onModelReady && { onReady: onModelReady })} />
              </group>
            </Suspense>
          </ModelBoundary>
        ) : (
          <Reaper head={head} stampArm={stampArm} penHand={penHand} magnifier={magnifier} />
        )}
      </group>
      {bubble && (
        <Html position={[0, 2.55, -0.3]} center zIndexRange={[20, 0]}>
          <div className="cm-bubble" role="status">
            {bubble}
          </div>
        </Html>
      )}
      <group ref={desk}>
        <Desk />
      </group>
    </group>
  );
}

interface Pose {
  armX: number;
  penX: number;
  penZ: number;
  headX: number;
  headY: number;
  deskY: number;
  /** Magnifying glass in the stamp hand (evidence inspection). */
  magnifier: boolean;
}

const REST: Pose = { armX: 0.5, penX: 0, penZ: 0, headX: 0, headY: 0, deskY: 0, magnifier: false };

/**
 * Procedural poses for the placeholder rig. `t` is seconds since the action started.
 * stamp: raise the chin hand, slam it down (desk jolts); gavel: three taps; pen: scribble then set it down;
 * reject: a slow head shake before the stamp.
 */
export function reaperPose(action: NonNullable<FxState['reaper']>['action'] | null, t: number): Pose {
  if (!action || t < 0 || t > 1.4) return REST;
  const jolt = (at: number) => (t > at && t < at + 0.12 ? -0.03 * Math.sin(((t - at) / 0.12) * Math.PI) : 0);
  switch (action) {
    case 'stamp': {
      const armX = t < 0.22 ? 0.5 - 1.6 * (t / 0.22) : t < 0.3 ? -1.1 + 2.4 * ((t - 0.22) / 0.08) : t < 0.7 ? 1.3 : 1.3 - 0.8 * Math.min(1, (t - 0.7) / 0.3);
      return { ...REST, armX, deskY: jolt(0.3) };
    }
    case 'gavel': {
      const beat = t % 0.22;
      const armX = t < 0.66 ? 0.5 - 1.2 * Math.sin((beat / 0.22) * Math.PI) : 0.5;
      return { ...REST, armX, deskY: jolt(0.11) + jolt(0.33) + jolt(0.55) };
    }
    case 'pen':
      return {
        ...REST,
        penX: t < 0.5 ? Math.sin(t * 40) * 0.04 : 0.12 * Math.min(1, (t - 0.5) / 0.2),
        penZ: t < 0.5 ? Math.cos(t * 33) * 0.02 : -0.05,
        headX: 0.15 * Math.min(1, t / 0.3),
      };
    case 'reject':
      return { ...REST, headY: t < 0.6 ? Math.sin(t * 22) * 0.25 * (1 - t / 0.6) : 0 };
    case 'tear': {
      // Both hands pull the statement apart, then fling the pieces.
      const pull = Math.min(1, t / 0.5);
      return { ...REST, armX: 0.5 - 0.9 * pull, penX: -0.25 * pull, penZ: -0.1 * pull, headX: -0.1, deskY: jolt(0.5) };
    }
    case 'inspect':
      return { ...REST, armX: -0.15, headX: 0.2, headY: Math.sin(t * 3) * 0.12, magnifier: t < 1.2 };
    case 'nod':
      return { ...REST, headX: Math.max(0, Math.sin(t * 10)) * 0.25 * (1 - t / 1.4) };
  }
}

/** Idle fidgets, each about 1.5 s long, then back to rest. */
export function idlePose(action: IdleAction, t: number, glance: number): Pose {
  if (t < 0 || t > 1.6) return REST;
  const bell = Math.sin(Math.min(1, t / 1.6) * Math.PI);
  switch (action) {
    case 'page':
      return { ...REST, penX: -0.2 * bell, penZ: 0.05 * bell, headX: 0.12 * bell };
    case 'yawn':
      return { ...REST, headX: -0.3 * bell, armX: 0.5 - 0.7 * bell };
    case 'polish':
      return { ...REST, armX: 0.5 - 0.3 * bell + Math.sin(t * 18) * 0.06 * bell, headY: -0.25 * bell };
    case 'glance':
      return { ...REST, headY: glance * bell };
  }
}

function Desk() {
  const top = DESK.height;
  const legX = DESK.width / 2 - 0.12;
  const legZ = DESK.depth / 2 - 0.12;
  return (
    <group position={[0, 0, 0.35]}>
      <RoundedBox args={[DESK.width, 0.12, DESK.depth]} radius={0.05} position={[0, top - 0.06, 0]}>
        <meshStandardMaterial color={PALETTE.desk} roughness={0.45} />
      </RoundedBox>
      {/* Modesty panel facing the viewer */}
      <RoundedBox args={[DESK.width - 0.2, top - 0.25, 0.06]} radius={0.03} position={[0, (top - 0.12) / 2 + 0.06, legZ]}>
        <meshStandardMaterial color={PALETTE.deskShade} roughness={0.5} />
      </RoundedBox>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <RoundedBox
            key={`${sx}${sz}`}
            args={[0.1, top - 0.12, 0.1]}
            radius={0.03}
            position={[sx * legX, (top - 0.12) / 2, sz * legZ]}
          >
            <meshStandardMaterial color={PALETTE.deskShade} roughness={0.5} />
          </RoundedBox>
        )),
      )}
      <PaperStacks
        stacks={[
          { position: [-0.75, top, -0.05], sheets: 9, seed: 'left' },
          { position: [-0.45, top, 0.2], sheets: 5, seed: 'mid' },
          { position: [0.8, top, -0.1], sheets: 6, seed: 'right' },
        ]}
      />
      {/* Open ledger in front of the reaper */}
      <group position={[0.05, top + 0.015, 0.12]}>
        <mesh rotation={[0, 0, 0.06]} position={[-0.2, 0, 0]}>
          <boxGeometry args={[0.38, 0.02, 0.5]} />
          <meshStandardMaterial color={PALETTE.paper} roughness={0.8} />
        </mesh>
        <mesh rotation={[0, 0, -0.06]} position={[0.2, 0, 0]}>
          <boxGeometry args={[0.38, 0.02, 0.5]} />
          <meshStandardMaterial color={PALETTE.paper} roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

interface StackSpec {
  position: [number, number, number];
  sheets: number;
  seed: string;
}

const sheetGeometry = new BoxGeometry(0.36, 0.022, 0.46);

/** All loose sheets on the desk in one draw call. */
function PaperStacks({ stacks }: { stacks: StackSpec[] }) {
  const items = useMemo(
    () =>
      stacks.flatMap(({ position: [x, y, z], sheets, seed }) => {
        const rnd = seededRandom(hashString(seed));
        return Array.from({ length: sheets }, (_, i) => ({
          matrix: trs([x + (rnd() - 0.5) * 0.03, y + 0.012 + i * 0.024, z], [0, (rnd() - 0.5) * 0.25, 0]),
        }));
      }),
    [stacks],
  );
  return (
    <StaticInstances geometry={sheetGeometry} items={items}>
      <meshStandardMaterial color={PALETTE.paper} roughness={0.85} />
    </StaticInstances>
  );
}

function Reaper({
  head,
  stampArm,
  penHand,
  magnifier,
}: {
  head: RefObject<Group | null>;
  stampArm: RefObject<Group | null>;
  penHand: RefObject<Group | null>;
  magnifier: RefObject<Group | null>;
}) {
  const robe = useMemo(
    () =>
      new LatheGeometry(
        [
          new Vector2(0, 0),
          new Vector2(0.62, 0),
          new Vector2(0.6, 0.08),
          new Vector2(0.5, 0.5),
          new Vector2(0.42, 0.95),
          new Vector2(0.3, 1.25),
          new Vector2(0, 1.32),
        ],
        32,
      ),
    [],
  );
  return (
    <group position={[0, 0.25, -0.35]}>
      <mesh geometry={robe}>
        <meshStandardMaterial color={PALETTE.robe} roughness={0.75} />
      </mesh>

      {/* Head: hood + skull face, tilted slightly as if thinking */}
      <group ref={head} position={[0, 1.55, 0.02]} rotation={[0.08, 0, -0.1]}>
        <mesh scale={[1, 1.04, 1]}>
          <sphereGeometry args={[0.46, 32, 24]} />
          <meshStandardMaterial color={PALETTE.robe} roughness={0.75} />
        </mesh>
        <mesh position={[0.05, 0.28, -0.32]} rotation={[-0.9, 0, -0.3]}>
          <coneGeometry args={[0.22, 0.45, 16]} />
          <meshStandardMaterial color={PALETTE.robe} roughness={0.75} />
        </mesh>
        <mesh position={[0, -0.04, 0.17]} scale={[1, 0.95, 0.85]}>
          <sphereGeometry args={[0.35, 32, 24]} />
          <meshStandardMaterial color={PALETTE.bone} roughness={0.35} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.13, -0.02, 0.45]} rotation={[0, 0, s * -0.35]} scale={[0.75, 1, 0.4]}>
            <sphereGeometry args={[0.09, 16, 12]} />
            <meshStandardMaterial color={PALETTE.eye} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[0, -0.16, 0.47]} scale={[1, 0.6, 0.4]}>
          <sphereGeometry args={[0.025, 8, 6]} />
          <meshStandardMaterial color={PALETTE.eye} />
        </mesh>
      </group>

      {/* Arms: the left rests on the ledger (it writes), the right props the chin (it stamps). */}
      <mesh position={[-0.35, 0.95, 0.45]} rotation={[1.2, 0, 0.3]}>
        <capsuleGeometry args={[0.1, 0.35, 6, 12]} />
        <meshStandardMaterial color={PALETTE.robeShade} roughness={0.75} />
      </mesh>
      <group ref={penHand} position={[-0.3, 1.0, 0.72]}>
        <mesh>
          <sphereGeometry args={[0.1, 16, 12]} />
          <meshStandardMaterial color={PALETTE.bone} roughness={0.4} />
        </mesh>
      </group>
      {/* Shoulder pivot; rotation.x swings the forearm and hand. */}
      <group ref={stampArm} position={[0.3, 1.02, 0.18]} rotation={[0.5, 0, -0.5]}>
        <mesh position={[0, 0.22, 0]}>
          <capsuleGeometry args={[0.1, 0.32, 6, 12]} />
          <meshStandardMaterial color={PALETTE.robeShade} roughness={0.75} />
        </mesh>
        <mesh position={[0, 0.48, 0]}>
          <sphereGeometry args={[0.1, 16, 12]} />
          <meshStandardMaterial color={PALETTE.bone} roughness={0.4} />
        </mesh>
        <group ref={magnifier} position={[0, 0.62, 0.06]} visible={false}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.13, 0.022, 8, 24]} />
            <meshStandardMaterial color={PALETTE.stirrer} roughness={0.4} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.12, 24]} />
            <meshStandardMaterial color="#cfe9ff" transparent opacity={0.45} roughness={0.05} />
          </mesh>
        </group>
      </group>

      {/* Coffee-stirrer scythe leaning against the chair */}
      <group position={[0.85, 0, -0.15]} rotation={[0, 0, -0.18]}>
        <mesh position={[0, 1.05, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 2.1, 10]} />
          <meshStandardMaterial color={PALETTE.stirrer} roughness={0.6} />
        </mesh>
        <mesh position={[-0.28, 2.02, 0]} rotation={[0, 0, Math.PI * 0.05]}>
          <torusGeometry args={[0.3, 0.045, 8, 24, Math.PI * 0.85]} />
          <meshStandardMaterial color={PALETTE.blade} metalness={0.3} roughness={0.35} />
        </mesh>
      </group>
    </group>
  );
}

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type RefObject } from 'react';
import {
  BoxGeometry,
  Color,
  IcosahedronGeometry,
  Matrix4,
  Object3D,
  OctahedronGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Group, InstancedMesh, Mesh, MeshStandardMaterial } from 'three';
import { cupGeometries } from '../cups/geometry';
import { PALETTE } from '../palette';
import { seededRandom } from '../random';
import type { BurstKind, FxState, Leaving, Vec3 } from './fx';
import { arcPoint, clamp01, easeInOutSine, easeInQuad, easeOutCubic } from './motion';

const FLYER_POOL = 16;
const LEAVING_POOL = 32;

/** Everything that exists only while an animation runs: flying bills and cups, particles, leaving cups. */
export function FxLayer({ fx, ghosts }: { fx: RefObject<FxState>; ghosts: RefObject<Leaving[]> }) {
  return (
    <group>
      <Flyers fx={fx} />
      <Bursts fx={fx} />
      <LeavingCups fx={fx} ghosts={ghosts} />
    </group>
  );
}

// ── flyers ──────────────────────────────────────────────────────────────────

const billGeometry = new BoxGeometry(0.42, 0.02, 0.3);

function Flyers({ fx }: { fx: RefObject<FxState> }) {
  const geo = cupGeometries();
  const bills = useRef<(Mesh | null)[]>([]);
  const cups = useRef<(Group | null)[]>([]);
  const sleeves = useRef<(MeshStandardMaterial | null)[]>([]);
  const color = useMemo(() => new Color(), []);

  useFrame(() => {
    const state = fx.current;
    if (!state) return;
    let b = 0;
    let c = 0;
    for (const f of state.flyers.values()) {
      const p = clamp01((state.now - f.t0) / f.duration);
      if (f.kind === 'bill') {
        const mesh = bills.current[b++];
        if (!mesh) continue;
        const pos = arcPoint(f.from, f.to, easeOutCubic(p), f.arc);
        mesh.visible = true;
        mesh.position.set(...pos);
        mesh.rotation.set(Math.sin(p * 9) * 0.4, p * Math.PI * 3, Math.cos(p * 7) * 0.3);
      } else {
        const group = cups.current[c];
        const sleeve = sleeves.current[c++];
        if (!group) continue;
        const pos = arcPoint(f.from, f.to, easeInQuad(p), 0);
        group.visible = true;
        group.position.set(...pos);
        group.rotation.set(0, (1 - p) * Math.PI * 1.5, (1 - p) * 0.4);
        sleeve?.color.copy(color.set(f.color));
      }
    }
    for (; b < FLYER_POOL; b++) if (bills.current[b]) bills.current[b]!.visible = false;
    for (; c < FLYER_POOL; c++) if (cups.current[c]) cups.current[c]!.visible = false;
  });

  return (
    <>
      {Array.from({ length: FLYER_POOL }, (_, i) => (
        <mesh key={`bill${i}`} ref={(m) => void (bills.current[i] = m)} geometry={billGeometry} visible={false}>
          <meshStandardMaterial color={PALETTE.paper} roughness={0.8} />
        </mesh>
      ))}
      {Array.from({ length: FLYER_POOL }, (_, i) => (
        <group key={`cup${i}`} ref={(g) => void (cups.current[i] = g)} visible={false}>
          <mesh geometry={geo.body}>
            <meshStandardMaterial color={PALETTE.cupPaper} roughness={0.55} />
          </mesh>
          <mesh geometry={geo.lid}>
            <meshStandardMaterial color={PALETTE.cupLid} roughness={0.35} />
          </mesh>
          <mesh geometry={geo.sleeve}>
            <meshStandardMaterial ref={(m) => void (sleeves.current[i] = m)} roughness={0.7} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ── particle bursts ─────────────────────────────────────────────────────────

interface BurstStyle {
  count: number;
  life: number;
  color: string;
  size: number;
  speed: number;
  gravity: number;
  /** Fraction of upward bias in the initial direction. */
  up: number;
}

const BURST: Record<BurstKind, BurstStyle> = {
  smoke: { count: 10, life: 0.7, color: '#b7aecb', size: 0.16, speed: 0.9, gravity: -0.6, up: 0.2 },
  splash: { count: 14, life: 0.6, color: '#6b4226', size: 0.06, speed: 2.4, gravity: 7, up: 0.7 },
  sparkle: { count: 16, life: 0.9, color: '#f2c94c', size: 0.07, speed: 1.6, gravity: 0.5, up: 0.6 },
  gold: { count: 18, life: 1.0, color: '#ffd76a', size: 0.08, speed: 1.4, gravity: -0.4, up: 0.8 },
  stamp: { count: 1, life: 0.9, color: '#e0443e', size: 0.9, speed: 0, gravity: 0, up: 0 },
  petals: { count: 28, life: 1.6, color: '#f7a8c8', size: 0.07, speed: 1.8, gravity: 1.2, up: 0.5 },
};
const BURST_CAPACITY = 160;
const KINDS = Object.keys(BURST) as BurstKind[];

function Bursts({ fx }: { fx: RefObject<FxState> }) {
  const meshes = useRef<Partial<Record<BurstKind, InstancedMesh | null>>>({});
  const geometries = useMemo(
    () => ({
      smoke: new IcosahedronGeometry(1, 1),
      splash: new IcosahedronGeometry(1, 0),
      sparkle: new OctahedronGeometry(1),
      gold: new OctahedronGeometry(1),
      stamp: new TorusGeometry(1, 0.08, 6, 32),
      petals: new IcosahedronGeometry(1, 0),
    }),
    [],
  );
  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3() }), []);

  useFrame(() => {
    const state = fx.current;
    if (!state) return;
    // Drop finished bursts.
    state.bursts = state.bursts.filter((b) => state.now - b.t0 < BURST[b.kind].life);
    const counts: Partial<Record<BurstKind, number>> = {};
    for (const b of state.bursts) {
      const style = BURST[b.kind];
      const mesh = meshes.current[b.kind];
      if (!mesh) continue;
      const t = state.now - b.t0;
      const life = clamp01(t / style.life);
      const rnd = seededRandom(b.seed);
      for (let i = 0; i < style.count; i++) {
        const n = counts[b.kind] ?? 0;
        if (n >= BURST_CAPACITY) break;
        const theta = rnd() * Math.PI * 2;
        const lift = style.up + rnd() * (1 - style.up);
        const speed = style.speed * (0.6 + rnd() * 0.6);
        const dir: Vec3 = [Math.cos(theta) * (1 - lift), lift, Math.sin(theta) * (1 - lift)];
        tmp.p.set(
          b.pos[0] + dir[0] * speed * t,
          b.pos[1] + dir[1] * speed * t - 0.5 * style.gravity * t * t,
          b.pos[2] + dir[2] * speed * t,
        );
        const size =
          b.kind === 'stamp'
            ? style.size * (1.4 - 0.4 * easeOutCubic(clamp01(t / 0.2)))
            : style.size * (b.kind === 'smoke' ? 1 + life * 1.5 : 1 - life * 0.7);
        tmp.s.setScalar(life >= 1 ? 0 : size);
        if (b.kind === 'stamp') tmp.q.setFromAxisAngle(new Vector3(1, 0, 0), 0);
        else tmp.q.identity();
        mesh.setMatrixAt(n, tmp.m.compose(tmp.p, tmp.q, tmp.s));
        counts[b.kind] = n + 1;
      }
    }
    for (const kind of KINDS) {
      const mesh = meshes.current[kind];
      if (!mesh) continue;
      mesh.count = counts[kind] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {KINDS.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(m) => void (meshes.current[kind] = m)}
          args={[geometries[kind], undefined, BURST_CAPACITY]}
          frustumCulled={false}
          count={0}
        >
          {kind === 'smoke' ? (
            <meshStandardMaterial color={BURST[kind].color} transparent opacity={0.55} roughness={1} depthWrite={false} />
          ) : (
            <meshBasicMaterial color={BURST[kind].color} />
          )}
        </instancedMesh>
      ))}
    </>
  );
}

// ── leaving cups ────────────────────────────────────────────────────────────

/**
 * Cups that just left the model: drawn as static ghosts until their removal cue starts, then evaporate
 * (rise + fade), turn gold and dissolve (waived), or ascend (redeemed; M5 sends them to a recipient).
 */
function LeavingCups({ fx, ghosts }: { fx: RefObject<FxState>; ghosts: RefObject<Leaving[]> }) {
  const geo = cupGeometries();
  const groups = useRef<(Group | null)[]>([]);
  const materials = useRef<MeshStandardMaterial[][]>([]);
  const dummy = useMemo(() => new Object3D(), []);
  const gold = useMemo(() => new Color('#ffd76a'), []);
  const paper = useMemo(() => new Color(PALETTE.cupPaper), []);

  useFrame(() => {
    const state = fx.current;
    if (!state) return;
    const items: { leaving: Leaving; p: number }[] = [
      ...(ghosts.current ?? []).filter((g) => !state.removalStarted.has(g.cupId)).map((leaving) => ({ leaving, p: 0 })),
      ...[...state.leaving.values()].map((leaving) => ({ leaving, p: clamp01((state.now - leaving.t0) / leaving.duration) })),
    ];
    let i = 0;
    for (const { leaving, p } of items) {
      const group = groups.current[i];
      const mats = materials.current[i++];
      if (!group || !mats) continue;
      leaving.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      group.visible = true;
      let opacity = 1 - easeInQuad(p);
      if (leaving.to) {
        // Redeemed: lift off, arc over to the recipient's pedestal, shrink into a coaster.
        const from: Vec3 = [dummy.position.x, dummy.position.y, dummy.position.z];
        group.position.set(...arcPoint(from, leaving.to, easeInOutSine(p), 2.4));
        group.scale.setScalar(1 - 0.6 * easeInQuad(p));
        group.quaternion.copy(dummy.quaternion);
        opacity = p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15;
      } else {
        const rise = leaving.style === 'ascend' ? easeInQuad(p) * 3 : easeOutCubic(p) * 0.6;
        group.position.set(dummy.position.x, dummy.position.y + rise, dummy.position.z);
        group.quaternion.copy(dummy.quaternion);
        group.scale.setScalar(1 + p * 0.15);
      }
      for (const m of mats) {
        m.opacity = opacity;
        const golden = (leaving.style === 'gold' || leaving.style === 'ascend') && m.userData.part === 'body';
        m.color.copy(m.userData.part === 'body' ? paper : m.color);
        if (golden) m.color.lerp(gold, clamp01(p * 2));
        m.emissive.copy(gold).multiplyScalar(golden ? clamp01(p * 2) * 0.8 : 0);
      }
    }
    for (; i < LEAVING_POOL; i++) if (groups.current[i]) groups.current[i]!.visible = false;
  });

  return (
    <>
      {Array.from({ length: LEAVING_POOL }, (_, i) => {
        const mats: MeshStandardMaterial[] = [];
        materials.current[i] = mats;
        const keep = (m: MeshStandardMaterial | null, part: string) => {
          if (m && !mats.includes(m)) {
            m.userData.part = part;
            mats.push(m);
          }
        };
        return (
          <group key={i} ref={(g) => void (groups.current[i] = g)} visible={false}>
            <mesh geometry={geo.body}>
              <meshStandardMaterial ref={(m) => keep(m, 'body')} color={PALETTE.cupPaper} transparent depthWrite={false} />
            </mesh>
            <mesh geometry={geo.lid}>
              <meshStandardMaterial ref={(m) => keep(m, 'lid')} color={PALETTE.cupLid} transparent depthWrite={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

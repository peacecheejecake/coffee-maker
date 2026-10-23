import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { BoxGeometry, Color, DoubleSide, Euler, Matrix4, PlaneGeometry, Quaternion, Vector3, type InstancedMesh } from 'three';
import type { FxState } from '../director/fx';
import { idleSwayAngle, landingScale, wobbleAngle } from '../director/motion';
import { capacityFor, trs } from '../instancing/StaticInstances';
import { PEDESTAL } from '../layout/dimensions';
import type { PlacedTower } from '../layout/sceneLayout';
import { PALETTE } from '../palette';
import { cobwebTexture, ripTexture } from './agingTextures';
import { cupGeometries } from './geometry';
import type { CupAgeStage } from '../model';

export const towerMatrix = (t: PlacedTower) => trs([t.slot.x, t.slot.y, t.slot.z], [0, t.slot.rotationY, 0]);

interface CupSlot {
  id: string;
  towerId: string;
  /** Position in its tower's loose-cup stack, bottom = 0 (drives the wobble delay). */
  index: number;
  towerSize: number;
  base: Matrix4;
  y: number;
  jitter: { rotationY: number; offsetX: number; offsetZ: number; tilt: number };
  color: Color;
  underReview: boolean;
  age: CupAgeStage;
  /** Per-tower phase so towers do not sway in unison. */
  phase: number;
}

function collectSlots(towers: readonly PlacedTower[]): CupSlot[] {
  return towers.flatMap((t) => {
    const base = towerMatrix(t);
    const color = new Color(t.tower.color);
    let index = 0;
    return t.items.flatMap((item) =>
      item.kind === 'cup'
        ? [
            {
              id: item.id,
              towerId: t.tower.id,
              index: index++,
              towerSize: t.tower.cups.length,
              base,
              y: item.y,
              jitter: item.jitter,
              color,
              underReview: !!item.cup.underReview,
              age: item.cup.age,
              phase: t.slot.x * 1.7,
            },
          ]
        : [],
    );
  });
}

/** Resting world matrix of every cup in the current layout (no animation applied). */
export function restingMatrices(towers: readonly PlacedTower[]): Map<string, Matrix4> {
  const out = new Map<string, Matrix4>();
  for (const s of collectSlots(towers)) out.set(s.id, s.base.clone().multiply(local(s, s.y, 0, 1, 1)));
  return out;
}

const tmp = { p: new Vector3(), q: new Quaternion(), e: new Euler(), s: new Vector3() };

function local(s: CupSlot, y: number, lean: number, xz: number, sy: number): Matrix4 {
  const { jitter } = s;
  // Leaning shifts the cup sideways in proportion to its height: the whole stack bends.
  tmp.p.set(jitter.offsetX + lean * (y - PEDESTAL.height), y, jitter.offsetZ);
  tmp.q.setFromEuler(tmp.e.set(jitter.tilt, jitter.rotationY, jitter.tilt * 0.5 - lean));
  tmp.s.set(xz, sy, xz);
  return new Matrix4().compose(tmp.p, tmp.q, tmp.s);
}

const tagGeometry = new BoxGeometry(0.16, 0.22, 0.012);
const tagOffset = trs([0.34, 0.62, 0.22], [0.1, 0.5, -0.25]);
const webGeometry = new PlaneGeometry(0.5, 0.5);
// Spans the gap between the rim and the lid edge on the viewer's side.
const webOffset = trs([-0.14, 0.86, 0.36], [0, 0.3, Math.PI]);
const ripGeometry = new PlaneGeometry(0.3, 0.375);
const ripOffset = trs([0, 0.45, 0.4], [-0.05, 0, 0]);

/**
 * Every cup in the scene in three draw calls (body, lid, sleeve) plus one for review tags.
 * Matrices are rewritten per frame only while something moves: stacks settling after a removal (spring),
 * a landing wobble travelling up a tower, or a just-landed cup's squash.
 */
export function CupInstances({
  towers,
  fx,
  hidden,
  idleSway = false,
}: {
  towers: readonly PlacedTower[];
  fx: RefObject<FxState>;
  /** Cups in the model that are still in the air (drawn by the FX layer until they land). */
  hidden: ReadonlySet<string>;
  idleSway?: boolean;
}) {
  const geo = cupGeometries();
  const invalidate = useThree((s) => s.invalidate);
  const slots = useMemo(() => collectSlots(towers), [towers]);
  const capacity = capacityFor(slots.length);
  const body = useRef<InstancedMesh>(null);
  const lid = useRef<InstancedMesh>(null);
  const sleeve = useRef<InstancedMesh>(null);
  const tags = useRef<InstancedMesh>(null);
  const ghostBody = useRef<InstancedMesh>(null);
  const ghostLid = useRef<InstancedMesh>(null);
  const webs = useRef<InstancedMesh>(null);
  const rips = useRef<InstancedMesh>(null);
  const displayY = useRef(new Map<string, number>());

  // Layout changed: draw at least one frame (the spring takes it from there).
  useLayoutEffect(() => invalidate(), [slots, hidden, invalidate]);

  useFrame((_, delta) => {
    const state = fx.current;
    const meshes = [body.current, lid.current, sleeve.current];
    const extras = [tags.current, ghostBody.current, ghostLid.current, webs.current, rips.current];
    if (!state || meshes.some((m) => !m) || extras.some((m) => !m)) return;
    const k = 1 - Math.exp(-12 * Math.min(delta, 1 / 20));
    let moving = false;
    let n = 0;
    let t = 0;
    let g = 0;
    let w = 0;
    let r = 0;
    const seen = new Set<string>();
    for (const s of slots) {
      if (hidden.has(s.id) && !state.landed.has(s.id)) continue;
      seen.add(s.id);
      let y = displayY.current.get(s.id) ?? s.y;
      y += (s.y - y) * k;
      if (Math.abs(s.y - y) < 1e-3) y = s.y;
      else moving = true;
      displayY.current.set(s.id, y);

      const impact = state.impacts.get(s.towerId);
      // Tall towers sway a little at rest (only rendered while the idle ticker runs).
      const sway = idleSway ? idleSwayAngle(state.now, s.towerSize, s.phase) : 0;
      const lean = (impact === undefined ? 0 : wobbleAngle(state.now - impact, s.index, s.towerSize)) + sway;
      const landing = state.landings.get(s.id);
      const [xz, sy] = landing === undefined ? [1, 1] : landingScale(state.now - landing);
      if (lean !== sway || sy !== 1) moving = true;

      const m = s.base.clone().multiply(local(s, y, lean, xz, sy));
      if (s.underReview) tags.current!.setMatrixAt(t++, m.clone().multiply(tagOffset));
      // 30+ days unpaid: the cup turns into a ghost of itself (DESIGN.md §1.4).
      if (s.age === 'ghost' || s.age === 'rip') {
        ghostBody.current!.setMatrixAt(g, m);
        ghostLid.current!.setMatrixAt(g++, m);
        if (s.age === 'rip') rips.current!.setMatrixAt(r++, m.clone().multiply(ripOffset));
        continue;
      }
      for (const mesh of meshes) mesh!.setMatrixAt(n, m);
      sleeve.current!.setColorAt(n, s.color);
      if (s.age === 'cobweb') webs.current!.setMatrixAt(w++, m.clone().multiply(webOffset));
      n++;
    }
    for (const id of displayY.current.keys()) if (!seen.has(id)) displayY.current.delete(id);
    const counts = new Map<InstancedMesh, number>([
      [tags.current!, t],
      [ghostBody.current!, g],
      [ghostLid.current!, g],
      [webs.current!, w],
      [rips.current!, r],
    ]);
    for (const mesh of [...meshes, ...extras]) {
      mesh!.count = counts.get(mesh!) ?? n;
      mesh!.instanceMatrix.needsUpdate = true;
      if (mesh!.instanceColor) mesh!.instanceColor.needsUpdate = true;
    }
    if (moving) invalidate();
  });

  return (
    <group>
      <instancedMesh key={`body-${capacity}`} ref={body} args={[geo.body, undefined, capacity]} frustumCulled={false}>
        <meshStandardMaterial color={PALETTE.cupPaper} roughness={0.55} />
      </instancedMesh>
      <instancedMesh key={`lid-${capacity}`} ref={lid} args={[geo.lid, undefined, capacity]} frustumCulled={false}>
        <meshStandardMaterial color={PALETTE.cupLid} roughness={0.35} />
      </instancedMesh>
      <instancedMesh key={`sleeve-${capacity}`} ref={sleeve} args={[geo.sleeve, undefined, capacity]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
      <instancedMesh key={`tag-${capacity}`} ref={tags} args={[tagGeometry, undefined, capacity]} frustumCulled={false}>
        <meshStandardMaterial color={PALETTE.review} emissive={PALETTE.review} emissiveIntensity={0.6} roughness={0.6} />
      </instancedMesh>
      <instancedMesh key={`gbody-${capacity}`} ref={ghostBody} args={[geo.body, undefined, capacity]} frustumCulled={false}>
        <meshStandardMaterial color="#cfe8ff" emissive="#7fd8ff" emissiveIntensity={0.35} transparent opacity={0.38} depthWrite={false} />
      </instancedMesh>
      <instancedMesh key={`glid-${capacity}`} ref={ghostLid} args={[geo.lid, undefined, capacity]} frustumCulled={false}>
        <meshStandardMaterial color="#9fb6d6" transparent opacity={0.3} depthWrite={false} />
      </instancedMesh>
      <instancedMesh key={`web-${capacity}`} ref={webs} args={[webGeometry, undefined, capacity]} frustumCulled={false}>
        <meshBasicMaterial map={cobwebTexture()} transparent side={DoubleSide} depthWrite={false} />
      </instancedMesh>
      <instancedMesh key={`rip-${capacity}`} ref={rips} args={[ripGeometry, undefined, capacity]} frustumCulled={false}>
        <meshStandardMaterial map={ripTexture()} transparent roughness={0.9} />
      </instancedMesh>
    </group>
  );
}

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type RefObject } from 'react';
import { Color, type InstancedMesh, type Matrix4 } from 'three';
import { towerMatrix } from '../cups/CupInstances';
import type { FxState } from '../director/fx';
import { flipAngle } from '../director/motion';
import { StaticInstances, trs, type InstanceSpec } from '../instancing/StaticInstances';
import { CARRIER_BOX, PEDESTAL } from '../layout/dimensions';
import type { PlacedTower } from '../layout/sceneLayout';
import { GRADE_COLORS, PALETTE } from '../palette';
import { BADGE, COASTERS, PLAQUE, carrierLabelTexture, fixtureGeometries } from './fixtures';

/** Pedestals, accent rings, nameplates, grade badges and carrier boxes for all towers: five draw calls total. */
export function TowerFixtures({ towers, fx }: { towers: readonly PlacedTower[]; fx: RefObject<FxState> }) {
  const geo = fixtureGeometries();
  const texture = carrierLabelTexture();
  const badgeMesh = useRef<InstancedMesh>(null);
  const flipping = useRef(false);

  const specs = useMemo(() => {
    const pedestals: InstanceSpec[] = [];
    const rings: InstanceSpec[] = [];
    const plaques: InstanceSpec[] = [];
    const badges: (InstanceSpec & { towerId: string; plaque: Matrix4 })[] = [];
    const boxes: InstanceSpec[] = [];
    const coasters: InstanceSpec[] = [];
    for (const t of towers) {
      const base = towerMatrix(t);
      const at = (m: ReturnType<typeof trs>) => base.clone().multiply(m);
      pedestals.push({ matrix: base });
      rings.push({ matrix: at(trs([0, PEDESTAL.height - 0.02, 0], [Math.PI / 2, 0, 0])), color: new Color(t.tower.color) });
      const plaque = trs([0, PLAQUE.y, PLAQUE.z], [PLAQUE.tilt, 0, 0]);
      plaques.push({ matrix: at(plaque) });
      badges.push({
        matrix: at(plaque.clone().multiply(badgeLocal(0))),
        color: new Color(GRADE_COLORS[t.tower.grade]),
        towerId: t.tower.id,
        plaque: at(plaque),
      });
      for (let k = 0; k < Math.min(COASTERS.max, t.tower.receivedCount); k++) {
        coasters.push({
          matrix: at(trs([COASTERS.x + (k % 2) * 0.02, COASTERS.height / 2 + k * COASTERS.height, COASTERS.z], [0, k * 0.4, 0])),
        });
      }
      for (const item of t.items) {
        if (item.kind !== 'box') continue;
        const { jitter } = item;
        boxes.push({
          matrix: at(trs([jitter.offsetX, item.y + CARRIER_BOX.height / 2, jitter.offsetZ], [0, jitter.rotationY, 0])),
        });
      }
    }
    return { pedestals, rings, plaques, badges, boxes, coasters };
  }, [towers]);

  // Grade changes spin the badge once; matrices are only rewritten while a flip runs (and once after).
  useFrame(() => {
    const state = fx.current;
    const mesh = badgeMesh.current;
    if (!state || !mesh) return;
    const active = specs.badges.some((b) => state.flips.has(b.towerId));
    if (!active && !flipping.current) return;
    specs.badges.forEach((b, i) => {
      const start = state.flips.get(b.towerId);
      const angle = start === undefined ? 0 : flipAngle(state.now - start);
      if (start !== undefined && angle === 0 && state.now - start > 0.6) state.flips.delete(b.towerId);
      mesh.setMatrixAt(i, b.plaque.clone().multiply(badgeLocal(angle)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    flipping.current = active;
  });

  return (
    <group>
      <StaticInstances geometry={geo.pedestal} items={specs.pedestals}>
        <meshStandardMaterial color={PALETTE.pedestal} roughness={0.6} />
      </StaticInstances>
      <StaticInstances geometry={geo.ring} items={specs.rings}>
        {/* Unlit so the player's color reads as a soft glow on the dark stage. */}
        <meshBasicMaterial />
      </StaticInstances>
      <StaticInstances geometry={geo.plaque} items={specs.plaques}>
        <meshStandardMaterial color={PALETTE.plaque} roughness={0.5} />
      </StaticInstances>
      <StaticInstances geometry={geo.badge} items={specs.badges} meshRef={badgeMesh}>
        <meshStandardMaterial roughness={0.4} />
      </StaticInstances>
      <StaticInstances geometry={geo.box} items={specs.boxes}>
        <meshStandardMaterial map={texture} roughness={0.85} />
      </StaticInstances>
      <StaticInstances geometry={geo.coaster} items={specs.coasters}>
        <meshStandardMaterial color={PALETTE.carrierBox} roughness={0.9} />
      </StaticInstances>
    </group>
  );
}

/** The grade badge disc on the nameplate, optionally spun around the plaque's vertical axis. */
const badgeLocal = (spin: number) =>
  trs([BADGE.x, 0, PLAQUE.size[2] / 2 + 0.005], [0, spin, 0]).multiply(trs([0, 0, 0], [Math.PI / 2, 0, 0]));


import { useMemo } from 'react';
import { Color } from 'three';
import { towerMatrix } from '../cups/CupInstances';
import { StaticInstances, trs, type InstanceSpec } from '../instancing/StaticInstances';
import { CARRIER_BOX, PEDESTAL } from '../layout/dimensions';
import type { PlacedTower } from '../layout/sceneLayout';
import { GRADE_COLORS, PALETTE } from '../palette';
import { BADGE, PLAQUE, carrierLabelTexture, fixtureGeometries } from './fixtures';

/** Pedestals, accent rings, nameplates, grade badges and carrier boxes for all towers: five draw calls total. */
export function TowerFixtures({ towers }: { towers: readonly PlacedTower[] }) {
  const geo = fixtureGeometries();
  const texture = carrierLabelTexture();

  const specs = useMemo(() => {
    const pedestals: InstanceSpec[] = [];
    const rings: InstanceSpec[] = [];
    const plaques: InstanceSpec[] = [];
    const badges: InstanceSpec[] = [];
    const boxes: InstanceSpec[] = [];
    for (const t of towers) {
      const base = towerMatrix(t);
      const at = (m: ReturnType<typeof trs>) => base.clone().multiply(m);
      pedestals.push({ matrix: base });
      rings.push({ matrix: at(trs([0, PEDESTAL.height - 0.02, 0], [Math.PI / 2, 0, 0])), color: new Color(t.tower.color) });
      const plaque = trs([0, PLAQUE.y, PLAQUE.z], [PLAQUE.tilt, 0, 0]);
      plaques.push({ matrix: at(plaque) });
      badges.push({
        matrix: at(plaque.clone().multiply(trs([BADGE.x, 0, PLAQUE.size[2] / 2 + 0.005], [Math.PI / 2, 0, 0]))),
        color: new Color(GRADE_COLORS[t.tower.grade]),
      });
      for (const item of t.items) {
        if (item.kind !== 'box') continue;
        const { jitter } = item;
        boxes.push({
          matrix: at(trs([jitter.offsetX, item.y + CARRIER_BOX.height / 2, jitter.offsetZ], [0, jitter.rotationY, 0])),
        });
      }
    }
    return { pedestals, rings, plaques, badges, boxes };
  }, [towers]);

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
      <StaticInstances geometry={geo.badge} items={specs.badges}>
        <meshStandardMaterial roughness={0.4} />
      </StaticInstances>
      <StaticInstances geometry={geo.box} items={specs.boxes}>
        <meshStandardMaterial map={texture} roughness={0.85} />
      </StaticInstances>
    </group>
  );
}

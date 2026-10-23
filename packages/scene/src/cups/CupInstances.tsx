import { useMemo } from 'react';
import { Color } from 'three';
import type { PlacedTower } from '../layout/sceneLayout';
import { PALETTE } from '../palette';
import { StaticInstances, trs, type InstanceSpec } from '../instancing/StaticInstances';
import { cupGeometries } from './geometry';

export const towerMatrix = (t: PlacedTower) => trs([t.slot.x, t.slot.y, t.slot.z], [0, t.slot.rotationY, 0]);

export function collectCupInstances(towers: readonly PlacedTower[]): InstanceSpec[] {
  return towers.flatMap((t) => {
    const base = towerMatrix(t);
    const color = new Color(t.tower.color);
    return t.items.flatMap((item) => {
      if (item.kind !== 'cup') return [];
      const { jitter } = item;
      const local = trs([jitter.offsetX, item.y, jitter.offsetZ], [jitter.tilt, jitter.rotationY, jitter.tilt * 0.5]);
      return [{ matrix: base.clone().multiply(local), color }];
    });
  });
}

/** Every cup in the scene in three draw calls (body, lid, sleeve), regardless of tower count. */
export function CupInstances({ towers }: { towers: readonly PlacedTower[] }) {
  const geo = cupGeometries();
  const cups = useMemo(() => collectCupInstances(towers), [towers]);
  const plain = useMemo(() => cups.map(({ matrix }) => ({ matrix })), [cups]);
  return (
    <group>
      <StaticInstances geometry={geo.body} items={plain}>
        <meshStandardMaterial color={PALETTE.cupPaper} roughness={0.55} />
      </StaticInstances>
      <StaticInstances geometry={geo.lid} items={plain}>
        <meshStandardMaterial color={PALETTE.cupLid} roughness={0.35} />
      </StaticInstances>
      <StaticInstances geometry={geo.sleeve} items={cups}>
        <meshStandardMaterial roughness={0.7} />
      </StaticInstances>
    </group>
  );
}

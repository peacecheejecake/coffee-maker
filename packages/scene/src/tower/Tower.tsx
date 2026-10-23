import { Text } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { Suspense } from 'react';
import { PEDESTAL } from '../layout/dimensions';
import type { PlacedTower } from '../layout/sceneLayout';
import { PALETTE } from '../palette';
import { BADGE, PLAQUE } from './fixtures';

interface TowerProps {
  placed: PlacedTower;
  fontUrl: string;
  onSelect?: (id: string) => void;
}

/** Per-tower parts that cannot be instanced: the name/grade text and the click target. */
export function Tower({ placed, fontUrl, onSelect }: TowerProps) {
  const { tower, slot, height } = placed;
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect?.(tower.id);
  };

  return (
    <group position={[slot.x, slot.y, slot.z]} rotation={[0, slot.rotationY, 0]}>
      <group position={[0, PLAQUE.y, PLAQUE.z]} rotation={[PLAQUE.tilt, 0, 0]}>
        <Suspense fallback={null}>
          <Text
            font={fontUrl}
            fontSize={0.17}
            maxWidth={0.82}
            position={[-0.14, 0, PLAQUE.size[2] / 2 + 0.005]}
            color={PALETTE.plaqueText}
            anchorX="center"
            anchorY="middle"
          >
            {tower.name}
          </Text>
          <Text
            font={fontUrl}
            fontSize={tower.grade === 'AAA' ? 0.075 : 0.12}
            position={[BADGE.x, 0, PLAQUE.size[2] / 2 + 0.02]}
            color={PALETTE.plaque}
            anchorX="center"
            anchorY="middle"
          >
            {tower.grade}
          </Text>
        </Suspense>
      </group>

      {/* Hit area covering the whole stack. three's raycaster ignores `visible`, so this costs no draw call. */}
      <mesh position={[0, height / 2, 0]} visible={false} onClick={click}>
        <cylinderGeometry args={[PEDESTAL.radius, PEDESTAL.radius, height + 0.2, 12]} />
      </mesh>
    </group>
  );
}

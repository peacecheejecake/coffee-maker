import { RoundedBox, Text } from '@react-three/drei';
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
          {tower.tag && <Tag text={tower.tag} fontUrl={fontUrl} />}
        </Suspense>
      </group>

      {/* Hit area covering the whole stack. three's raycaster ignores `visible`, so this costs no draw call. */}
      <mesh position={[0, height / 2, 0]} visible={false} onClick={click}>
        <cylinderGeometry args={[PEDESTAL.radius, PEDESTAL.radius, height + 0.2, 12]} />
      </mesh>
    </group>
  );
}

/** Same width as the plaque below it, a small gap above it, and about as thick. */
const TAG = { fontSize: 0.14, height: 0.21, gap: 0.04, depth: 0.07, radius: 0.035, opacity: 0.7 } as const;

/** Caption above the plaque (e.g. "관전 중") on a translucent rounded white block as wide as the name plaque. */
function Tag({ text, fontUrl }: { text: string; fontUrl: string }) {
  const [width] = PLAQUE.size;
  return (
    <group position={[0, PLAQUE.size[1] / 2 + TAG.gap + TAG.height / 2, 0]}>
      <RoundedBox args={[width, TAG.height, TAG.depth]} radius={TAG.radius} smoothness={4}>
        {/* Lit, so the rounded edges and sides read as thickness. */}
        <meshStandardMaterial color={PALETTE.tagBackdrop} transparent opacity={TAG.opacity} depthWrite={false} />
      </RoundedBox>
      <Text
        font={fontUrl}
        fontSize={TAG.fontSize}
        maxWidth={width - TAG.radius * 2}
        position={[0, 0, TAG.depth / 2 + 0.004]}
        color={PALETTE.spectator}
        anchorX="center"
        anchorY="middle"
      >
        {text}
      </Text>
    </group>
  );
}

import { Text } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { Suspense, useState } from 'react';
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

const TAG = { fontSize: 0.14, padX: 0.07, padY: 0.035 } as const;

/** Caption above the plaque (e.g. "관전 중") on a translucent white pill sized to the rendered text. */
function Tag({ text, fontUrl }: { text: string; fontUrl: string }) {
  // Measured from troika's layout once the glyphs are ready; until then only the text shows.
  const [width, setWidth] = useState(0);
  const onSync = (mesh: { textRenderInfo?: { blockBounds: number[] } }) => {
    const b = mesh.textRenderInfo?.blockBounds;
    if (b) setWidth(b[2]! - b[0]!);
  };
  const height = TAG.fontSize + TAG.padY * 2;
  const z = PLAQUE.size[2] / 2 + 0.005;

  return (
    <group position={[0, PLAQUE.size[1] / 2 + 0.11, 0]}>
      {width > 0 && (
        <mesh position={[0, 0, z]}>
          <planeGeometry args={[width + TAG.padX * 2, height]} />
          <meshBasicMaterial color={PALETTE.tagBackdrop} transparent opacity={0.6} depthWrite={false} />
        </mesh>
      )}
      <Text
        font={fontUrl}
        fontSize={TAG.fontSize}
        maxWidth={1.2}
        position={[0, 0, z + 0.004]}
        color={PALETTE.spectator}
        anchorX="center"
        anchorY="middle"
        onSync={onSync}
      >
        {text}
      </Text>
    </group>
  );
}

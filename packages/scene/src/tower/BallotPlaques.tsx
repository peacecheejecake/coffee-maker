import { useMemo } from 'react';
import { PEDESTAL } from '../layout/dimensions';
import type { PlacedTower } from '../layout/sceneLayout';
import { PALETTE } from '../palette';

/**
 * While a waiver is under review, each voter's pedestal shows their ballot (DESIGN.md §2.6):
 * a lotus for approve, a little skull for reject.
 */
export function BallotPlaques({ towers }: { towers: readonly PlacedTower[] }) {
  const voters = useMemo(() => towers.filter((t) => t.tower.ballot), [towers]);
  return (
    <>
      {voters.map(({ tower, slot }) => (
        <group
          key={tower.id}
          position={[slot.x, slot.y + PEDESTAL.height, slot.z]}
          rotation={[0, slot.rotationY, 0]}
        >
          <group position={[-PEDESTAL.radius + 0.12, 0.08, PEDESTAL.radius - 0.12]} scale={0.55}>
            {tower.ballot === 'approve' ? <Lotus /> : <Skull />}
          </group>
        </group>
      ))}
    </>
  );
}

function Lotus() {
  return (
    <group>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} rotation={[0.9, (i / 6) * Math.PI * 2, 0]} position={[0, 0.08, 0]} scale={[0.09, 0.22, 0.05]}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color={PALETTE.lotus} emissive={PALETTE.lotus} emissiveIntensity={0.25} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0.1, 0]}>
        <sphereGeometry args={[0.06, 12, 8]} />
        <meshStandardMaterial color="#ffe08a" emissive="#ffe08a" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

function Skull() {
  return (
    <group position={[0, 0.16, 0]}>
      <mesh>
        <sphereGeometry args={[0.16, 16, 12]} />
        <meshStandardMaterial color={PALETTE.bone} roughness={0.4} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.055, 0.01, 0.135]} scale={[1, 1.2, 0.5]}>
          <sphereGeometry args={[0.04, 10, 8]} />
          <meshStandardMaterial color={PALETTE.eye} />
        </mesh>
      ))}
    </group>
  );
}

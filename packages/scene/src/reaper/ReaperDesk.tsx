import { RoundedBox } from '@react-three/drei';
import { useMemo } from 'react';
import { BoxGeometry, LatheGeometry, Vector2 } from 'three';
import { StaticInstances, trs } from '../instancing/StaticInstances';
import { DESK } from '../layout/dimensions';
import { PALETTE } from '../palette';
import { hashString, seededRandom } from '../random';

/**
 * Placeholder reaper built from primitives (DESIGN.md §2.5): a chibi reaper in a hooded robe, chin on hand,
 * sitting behind a cream desk with paper stacks. Replaced by a rigged glb in M6 behind the same position.
 */
export function ReaperDesk() {
  return (
    <group position={[...DESK.position]}>
      <Reaper />
      <Desk />
    </group>
  );
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

function Reaper() {
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
      <group position={[0, 1.55, 0.02]} rotation={[0.08, 0, -0.1]}>
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

      {/* Arms: one resting on the desk, one propping the chin */}
      <mesh position={[-0.35, 0.95, 0.45]} rotation={[1.2, 0, 0.3]}>
        <capsuleGeometry args={[0.1, 0.35, 6, 12]} />
        <meshStandardMaterial color={PALETTE.robeShade} roughness={0.75} />
      </mesh>
      <mesh position={[-0.3, 1.0, 0.72]}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshStandardMaterial color={PALETTE.bone} roughness={0.4} />
      </mesh>
      <mesh position={[0.28, 1.12, 0.38]} rotation={[0.5, 0, -0.5]}>
        <capsuleGeometry args={[0.1, 0.32, 6, 12]} />
        <meshStandardMaterial color={PALETTE.robeShade} roughness={0.75} />
      </mesh>
      <mesh position={[0.17, 1.33, 0.55]}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshStandardMaterial color={PALETTE.bone} roughness={0.4} />
      </mesh>

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

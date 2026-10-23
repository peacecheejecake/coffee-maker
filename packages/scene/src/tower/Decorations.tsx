import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { CanvasTexture, DoubleSide, RepeatWrapping, SRGBColorSpace, type Group, type Mesh } from 'three';
import { PEDESTAL } from '../layout/dimensions';
import type { PlacedTower } from '../layout/sceneLayout';
import { GRADE_COLORS } from '../palette';

/** Height milestones and state badges (DESIGN.md §4.3, §2.3 상황 연출). */
export const MILESTONES = { caution: 5, flag: 15, clouds: 20, streak: 3 } as const;

export function Decorations({ towers }: { towers: readonly PlacedTower[] }) {
  return (
    <>
      {towers.map((t) => (
        <TowerDecor key={t.tower.id} placed={t} />
      ))}
    </>
  );
}

function TowerDecor({ placed }: { placed: PlacedTower }) {
  const { tower, slot, height } = placed;
  const cups = tower.cups.length;
  const streak = tower.streak;
  return (
    <group position={[slot.x, slot.y, slot.z]} rotation={[0, slot.rotationY, 0]}>
      {cups >= MILESTONES.caution && <CautionTape y={Math.min(height - 0.4, PEDESTAL.height + 1.7)} />}
      {cups >= MILESTONES.flag && <Flag y={height} color={tower.color} />}
      {cups >= MILESTONES.clouds && <Clouds y={height * 0.55} />}
      {tower.crowned && <Crown y={height + (cups >= MILESTONES.flag ? 0.05 : 0.02)} />}
      {tower.grade === 'D' && <Chains />}
      {(tower.grade === 'D' || (streak?.kind === 'late' && streak.count >= MILESTONES.streak)) && <Hellfire />}
      {streak?.kind === 'onTime' && streak.count >= MILESTONES.streak && <Halo />}
    </group>
  );
}

let tapeTexture: CanvasTexture | undefined;
function cautionTexture() {
  if (tapeTexture) return tapeTexture;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f2c94c';
    ctx.fillRect(0, 0, 256, 32);
    ctx.fillStyle = '#1b1830';
    for (let x = -32; x < 256; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 32);
      ctx.lineTo(x + 12, 32);
      ctx.lineTo(x + 28, 0);
      ctx.lineTo(x + 16, 0);
      ctx.fill();
    }
    ctx.fillStyle = '#f2c94c';
    ctx.fillRect(84, 6, 88, 20);
    ctx.fillStyle = '#1b1830';
    ctx.font = '700 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CAUTION', 128, 22);
  }
  tapeTexture = new CanvasTexture(c);
  tapeTexture.wrapS = RepeatWrapping;
  tapeTexture.repeat.set(2, 1);
  tapeTexture.colorSpace = SRGBColorSpace;
  return tapeTexture;
}

function CautionTape({ y }: { y: number }) {
  return (
    <mesh position={[0, y, 0]} rotation={[0.06, 0, 0.04]}>
      <cylinderGeometry args={[0.5, 0.5, 0.12, 32, 1, true]} />
      <meshStandardMaterial map={cautionTexture()} side={DoubleSide} roughness={0.7} />
    </mesh>
  );
}

function Flag({ y, color }: { y: number; color: string }) {
  const cloth = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (cloth.current) cloth.current.rotation.y = Math.sin(clock.elapsedTime * 3) * 0.25;
  });
  return (
    <group position={[0.12, y, 0]}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.9, 6]} />
        <meshStandardMaterial color="#d9d4cc" />
      </mesh>
      <mesh ref={cloth} position={[0.2, 0.75, 0]}>
        <planeGeometry args={[0.4, 0.26]} />
        <meshStandardMaterial color={color} side={DoubleSide} emissive={color} emissiveIntensity={0.2} />
      </mesh>
    </group>
  );
}

function Clouds({ y }: { y: number }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = clock.elapsedTime * 0.08;
  });
  const puffs = useMemo(
    () => [
      [1.1, 0, 0.3, 0.42],
      [1.4, 0.12, 0.1, 0.32],
      [-1.2, 0.4, -0.2, 0.38],
      [-1.45, 0.3, 0.05, 0.28],
    ],
    [],
  );
  return (
    <group ref={group} position={[0, y, 0]}>
      {puffs.map(([x, py, z, r], i) => (
        <mesh key={i} position={[x!, py!, z!]} scale={[1.6, 0.8, 1]}>
          <sphereGeometry args={[r!, 16, 12]} />
          <meshStandardMaterial color="#f3f0fa" transparent opacity={0.85} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function Crown({ y }: { y: number }) {
  return (
    <group position={[0, y + 0.08, 0]}>
      <mesh>
        <cylinderGeometry args={[0.24, 0.26, 0.14, 20, 1, true]} />
        <meshStandardMaterial color={GRADE_COLORS.AAA} metalness={0.6} roughness={0.3} side={DoubleSide} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.24, 0.13, Math.sin(a) * 0.24]}>
            <coneGeometry args={[0.05, 0.14, 6]} />
            <meshStandardMaterial color={GRADE_COLORS.AAA} metalness={0.6} roughness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

function Chains() {
  const links = 14;
  return (
    <group position={[0, PEDESTAL.height * 0.55, 0]}>
      {Array.from({ length: links }, (_, i) => {
        const a = (i / links) * Math.PI * 2;
        const r = PEDESTAL.radius + 0.07;
        return (
          <mesh key={i} position={[Math.cos(a) * r, 0, Math.sin(a) * r]} rotation={[i % 2 ? Math.PI / 2 : 0, -a, 0]}>
            <torusGeometry args={[0.06, 0.016, 6, 12]} />
            <meshStandardMaterial color="#6f6a78" metalness={0.7} roughness={0.35} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Flickering flames under the pedestal (grade D or a late streak). */
function Hellfire() {
  const flames = useRef<(Mesh | null)[]>([]);
  const n = 7;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    flames.current.forEach((f, i) => {
      if (!f) return;
      const s = 0.7 + 0.35 * Math.abs(Math.sin(t * 7 + i * 1.7));
      f.scale.set(1, s, 1);
    });
  });
  return (
    <group position={[0, 0.02, 0]}>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        const r = PEDESTAL.radius + 0.12;
        return (
          <mesh key={i} ref={(m) => void (flames.current[i] = m)} position={[Math.cos(a) * r, 0.14, Math.sin(a) * r]}>
            <coneGeometry args={[0.07, 0.3, 8]} />
            <meshBasicMaterial color={i % 2 ? '#ff7a2f' : '#ffb340'} transparent opacity={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

/** A soft golden ring floating over the pedestal for a run of on-time days. */
function Halo() {
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.position.y = PEDESTAL.height + 0.25 + Math.sin(clock.elapsedTime * 2) * 0.04;
  });
  return (
    <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[PEDESTAL.radius - 0.05, 0.02, 8, 40]} />
      <meshBasicMaterial color="#ffe08a" transparent opacity={0.85} />
    </mesh>
  );
}

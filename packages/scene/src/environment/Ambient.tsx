import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { IcosahedronGeometry, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';
import type { PlacedTower } from '../layout/sceneLayout';
import { seededRandom } from '../random';

export type TimeOfDay = 'morning' | 'day' | 'evening';

export const timeOfDayFor = (hour: number): TimeOfDay => (hour < 11 ? 'morning' : hour < 17 ? 'day' : 'evening');

/** Light presets (DESIGN.md §4.2): warm morning, neutral day, candle-lit evening. */
export const LIGHTS: Record<TimeOfDay, { key: string; keyIntensity: number; sky: string; ground: string; hemi: number; rim: number }> = {
  morning: { key: '#ffcf9a', keyIntensity: 2.4, sky: '#a5a8ff', ground: '#4a3040', hemi: 0.9, rim: 1.4 },
  day: { key: '#fff1dc', keyIntensity: 2.6, sky: '#b9c4ff', ground: '#3b2b3e', hemi: 1.05, rim: 1.2 },
  evening: { key: '#ffb46b', keyIntensity: 1.7, sky: '#7d78d6', ground: '#2a1e30', hemi: 0.75, rim: 1.9 },
};

/**
 * Keeps idle motion alive (steam, wisps, sway) at a low frame rate without a continuous render loop:
 * asks for ~15 frames/s while the page is visible. Adaptive: if frames take long (slow GPU, software
 * rendering) it backs off, down to one frame a second, so idle decoration never starves the UI.
 * Off for reduced motion.
 */
export function IdleTicker({ fps = 15, enabled }: { fps?: number; enabled: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const lastFrame = useRef(0);
  const frameCost = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (lastFrame.current) frameCost.current = frameCost.current * 0.8 + (now - lastFrame.current) * 0.2;
    lastFrame.current = now;
  });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const base = 1000 / fps;
    const tick = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      invalidate();
      // Frames slower than twice the budget mean the device is struggling: wait proportionally longer.
      const delay = frameCost.current > base * 2 ? Math.min(1000, frameCost.current * 2) : base;
      timer = setTimeout(tick, delay);
    };
    const onVisibility = () => {
      clearTimeout(timer);
      lastFrame.current = 0;
      tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, fps, invalidate]);
  return null;
}

const WISPS = 36;
const wispGeometry = new IcosahedronGeometry(0.05, 0);

/** Drifting soul-lights (반딧불 영혼) in the background. */
export function Wisps() {
  const mesh = useRef<InstancedMesh>(null);
  const seeds = useMemo(() => {
    const rnd = seededRandom(42);
    return Array.from({ length: WISPS }, () => ({
      x: (rnd() - 0.5) * 26,
      y: 0.8 + rnd() * 7,
      z: -4 - rnd() * 10,
      speed: 0.2 + rnd() * 0.4,
      phase: rnd() * Math.PI * 2,
      size: 0.6 + rnd() * 0.9,
    }));
  }, []);
  const tmp = useMemo(() => ({ m: new Matrix4(), p: new Vector3(), q: new Quaternion(), s: new Vector3() }), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    seeds.forEach((w, i) => {
      tmp.p.set(w.x + Math.sin(t * w.speed + w.phase) * 0.8, w.y + Math.sin(t * w.speed * 1.3 + w.phase) * 0.5, w.z);
      const pulse = 0.6 + 0.4 * Math.sin(t * 2 + w.phase);
      tmp.s.setScalar(w.size * pulse);
      m.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s));
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[wispGeometry, undefined, WISPS]} frustumCulled={false}>
      <meshBasicMaterial color="#9fe8ff" transparent opacity={0.7} depthWrite={false} />
    </instancedMesh>
  );
}

const STEAM_PER_TOWER = 3;
const steamGeometry = new IcosahedronGeometry(0.12, 1);

/** Steam curling up from the top cup of every tower. */
export function Steam({ towers }: { towers: readonly PlacedTower[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const tops = useMemo(
    () => towers.filter((t) => t.items.some((i) => i.kind === 'cup')).map((t) => ({ x: t.slot.x, y: t.slot.y + t.height + 0.05, z: t.slot.z })),
    [towers],
  );
  const tmp = useMemo(() => ({ m: new Matrix4(), p: new Vector3(), q: new Quaternion(), s: new Vector3() }), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    let n = 0;
    tops.forEach((top, ti) => {
      for (let k = 0; k < STEAM_PER_TOWER; k++) {
        const life = (t * 0.45 + k / STEAM_PER_TOWER + ti * 0.17) % 1;
        tmp.p.set(top.x + Math.sin((life + k) * 6) * 0.08, top.y + life * 0.9, top.z + Math.cos((life + ti) * 5) * 0.06);
        tmp.s.setScalar((0.5 + life) * (1 - life));
        m.setMatrixAt(n++, tmp.m.compose(tmp.p, tmp.q, tmp.s));
      }
    });
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[steamGeometry, undefined, Math.max(1, towers.length * STEAM_PER_TOWER)]} frustumCulled={false}>
      <meshStandardMaterial color="#e9e4f5" transparent opacity={0.35} depthWrite={false} roughness={1} />
    </instancedMesh>
  );
}

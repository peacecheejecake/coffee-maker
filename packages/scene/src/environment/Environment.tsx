import { ContactShadows } from '@react-three/drei';
import { useMemo } from 'react';
import { CanvasTexture } from 'three';
import { PALETTE } from '../palette';
import { LIGHTS, type TimeOfDay } from './Ambient';

export function Lighting({ timeOfDay = 'day' }: { timeOfDay?: TimeOfDay }) {
  const l = LIGHTS[timeOfDay];
  return (
    <>
      <hemisphereLight args={[l.sky, l.ground, l.hemi]} />
      <directionalLight color={l.key} intensity={l.keyIntensity} position={[-4, 9, 7]} />
      <directionalLight color={PALETTE.rimLight} intensity={l.rim} position={[3, 5, -8]} />
      <ambientLight intensity={0.15} />
    </>
  );
}

/** Radial alpha so the floor fades into the CSS background instead of ending in a hard edge. */
function useRadialFade(): CanvasTexture {
  return useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.55, '#aaa');
      g.addColorStop(1, '#000');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    return new CanvasTexture(canvas);
  }, []);
}

/** `shadowKey` changes whenever the silhouettes on the floor change; shadows are baked once per key. */
export function Floor({ shadowKey }: { shadowKey: string }) {
  const fade = useRadialFade();
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, -1.5]}>
        <circleGeometry args={[16, 64]} />
        <meshStandardMaterial color={PALETTE.floor} roughness={1} transparent alphaMap={fade} depthWrite={false} />
      </mesh>
      <ContactShadows
        key={shadowKey}
        frames={1}
        position={[0, 0, -1.5]}
        scale={30}
        resolution={1024}
        far={6}
        blur={2.4}
        opacity={0.55}
      />
    </>
  );
}

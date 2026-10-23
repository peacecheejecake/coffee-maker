import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Component, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { LoopOnce, LoopRepeat, type AnimationAction, type Group } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FxState } from '../director/fx';

/** Clip names authored in scripts/blender/reaper.py. */
export const REAPER_CLIPS = ['idle', 'stamp', 'gavel', 'pen', 'nod', 'reject', 'tear', 'inspect', 'yawn', 'page', 'polish', 'glance'] as const;

const FADE = 0.15;
const IDLE_ACTIONS = ['page', 'yawn', 'polish', 'glance'] as const;

/**
 * The rigged reaper (glb from Blender). Scene actions (fx.reaper) play their clip once; between them the
 * reaper idles, fidgets every few seconds, and reads the roll just before start time.
 */
export function ReaperModel({
  url,
  fx,
  idle,
  rollCall,
  onReady,
}: {
  url: string;
  fx: RefObject<FxState>;
  idle: boolean;
  rollCall: boolean;
  /** Called once the model is loaded and posed. */
  onReady?: () => void;
}) {
  const gltf = useGLTF(url, false, true);
  // A private copy so two scenes (or remounts) never share one skeleton.
  const model = useMemo(() => cloneSkinned(gltf.scene), [gltf.scene]);
  const root = useRef<Group>(null);
  const { actions, mixer } = useAnimations(gltf.animations, root);
  const current = useRef<{ name: string; action: AnimationAction } | null>(null);
  const lastEvent = useRef<number | null>(null);
  const nextFidget = useRef(0);

  const play = (name: string, loop: boolean) => {
    const action = actions[name];
    if (!action || current.current?.name === name) return;
    action.reset();
    action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = false;
    // The very first clip starts at full weight: a fade from the bind pose would show it (magnifier and
    // all) for as long as frames are not being rendered.
    if (current.current) {
      action.fadeIn(FADE).play();
      current.current.action.fadeOut(FADE);
    } else {
      action.setEffectiveWeight(1).play();
    }
    current.current = { name, action };
  };

  // Apply the resting clip before the first paint: the bind pose holds the magnifier out in front.
  useLayoutEffect(() => {
    play(rollCall ? 'page' : 'idle', true);
    mixer.update(0);
    onReady?.();
    // useAnimations stops every action on unmount (and on StrictMode's rehearsal unmount): start over.
    return () => {
      current.current?.action.stop();
      current.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, mixer, rollCall]);

  useFrame(({ clock }) => {
    const reaper = fx.current?.reaper;
    if (reaper && reaper.t0 !== lastEvent.current) {
      lastEvent.current = reaper.t0;
      play(reaper.action, false);
      return;
    }
    const cur = current.current;
    // A one-shot clip has finished: back to idle.
    if (cur && cur.action.loop === LoopOnce && !cur.action.isRunning()) play(rollCall ? 'page' : 'idle', true);
    if (idle && !rollCall && cur?.name === 'idle' && clock.elapsedTime > nextFidget.current) {
      nextFidget.current = clock.elapsedTime + 5 + Math.random() * 6;
      if (nextFidget.current > 6) play(IDLE_ACTIONS[Math.floor(Math.random() * IDLE_ACTIONS.length)]!, false);
    }
  });

  return (
    <group ref={root}>
      <primitive object={model} />
    </group>
  );
}

/** Falls back to the primitive reaper if the model cannot load (offline first run, old GPU, tests). */
export class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

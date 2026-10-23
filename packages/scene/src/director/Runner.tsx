import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useImperativeHandle, useRef, type Ref, type RefObject } from 'react';
import type { SceneEvent } from '../model';
import { timelineFor, type DirectorEnv, type FxContext } from './director';
import { clearTransient, fxBusy, type FxState } from './fx';
import { TimelineRun } from './timeline';

/** Five or more queued events (e.g. catching up after sync) play together, without camera moves. */
export const COMPACT_THRESHOLD = 5;

export interface RunnerHandle {
  /** Jumps every queued animation to its end state. Returns false if nothing was playing. */
  skip(): boolean;
  busy(): boolean;
}

interface Active {
  ids: string[];
  run: TimelineRun<FxContext>;
  t0: number;
}

interface RunnerProps {
  events: readonly SceneEvent[];
  onConsumed: (ids: string[]) => void;
  fx: RefObject<FxState>;
  env: DirectorEnv;
  reduced: boolean;
  timeScale: number;
  onFocus: (towerId: string | null) => void;
  handle: Ref<RunnerHandle>;
}

/**
 * Plays scene events one after another (AnimationQueue, PLAN.md M4). Owns the scene clock and keeps the
 * demand-driven render loop awake only while something moves.
 */
export function Runner({ events, onConsumed, fx, env, reduced, timeScale, onFocus, handle }: RunnerProps) {
  const invalidate = useThree((s) => s.invalidate);
  const active = useRef<Active | null>(null);
  const consumed = useRef(new Set<string>());
  const lastFocus = useRef<string | null>(null);
  const envRef = useRef(env);
  envRef.current = env;

  // New events (or anything else changing) need a frame to get started.
  useEffect(() => invalidate(), [events, invalidate]);

  const pending = () => events.filter((e) => !consumed.current.has(e.id) && !active.current?.ids.includes(e.id));

  const finish = (ids: string[]) => {
    ids.forEach((id) => consumed.current.add(id));
    active.current = null;
    onConsumed(ids);
  };

  const begin = (now: number): Active | null => {
    const queue = pending();
    if (queue.length === 0) return null;
    const compact = queue.length >= COMPACT_THRESHOLD;
    const batch = compact ? queue : queue.slice(0, 1);
    const timelines = batch.map((e) => timelineFor(e, { reduced, compact }));
    const cues = timelines.flatMap((t) => t.cues).sort((a, b) => a.at - b.at);
    const duration = Math.max(0, ...timelines.map((t) => t.duration));
    return { ids: batch.map((e) => e.id), run: new TimelineRun(cues, duration), t0: now };
  };

  const ctx = (): FxContext => ({ fx: fx.current!, env: envRef.current });

  const syncFocus = () => {
    const f = fx.current?.focus ?? null;
    if (f !== lastFocus.current) {
      lastFocus.current = f;
      onFocus(f);
    }
  };

  useImperativeHandle(handle, () => ({
    skip() {
      const state = fx.current;
      if (!state) return false;
      const wasBusy = active.current !== null || pending().length > 0;
      // Fire every remaining cue so landed/removed bookkeeping reaches its final state.
      while (active.current || pending().length > 0) {
        active.current ??= begin(state.now);
        if (!active.current) break;
        active.current.run.advance(Infinity, ctx());
        finish(active.current.ids);
      }
      clearTransient(state);
      syncFocus();
      invalidate();
      return wasBusy;
    },
    busy: () => active.current !== null || pending().length > 0,
  }));

  useFrame((_, delta) => {
    const state = fx.current;
    if (!state) return;
    // Clamp so a long idle gap (demand frameloop) does not fast-forward animations.
    state.now += Math.min(delta, 1 / 20) * timeScale;

    active.current ??= begin(state.now);
    if (active.current && active.current.run.advance(state.now - active.current.t0, ctx())) {
      finish(active.current.ids);
      active.current = begin(state.now);
    }
    syncFocus();
    if (active.current || fxBusy(state)) invalidate();
  });

  return null;
}

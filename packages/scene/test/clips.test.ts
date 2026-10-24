import { AnimationClip, AnimationMixer, LoopOnce, Object3D, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { FADE, startClip } from '../src/reaper/clips';

/** Like the glb: the bind pose has the magnifier at full size; every clip keys it at 0.001 when unused. */
function rig() {
  const root = new Object3D();
  const magnifier = new Object3D();
  magnifier.name = 'magnifier';
  root.add(magnifier);
  const hidden = (name: string, duration: number) =>
    new AnimationClip(name, duration, [
      new VectorKeyframeTrack('magnifier.scale', [0, duration], [0.001, 0.001, 0.001, 0.001, 0.001, 0.001]),
    ]);
  const mixer = new AnimationMixer(root);
  return { magnifier, mixer, idle: mixer.clipAction(hidden('idle', 3)), nod: mixer.clipAction(hidden('nod', 0.7)) };
}

describe('reaper clip cross-fades', () => {
  it('never lets the bind pose (full-size magnifier) show when a one-shot finishes', () => {
    const { magnifier, mixer, idle, nod } = rig();
    startClip(idle, null, true);
    mixer.update(0);
    startClip(nod, idle, false);
    let current = nod;
    let peak = 0;
    for (let t = 0; t < 2; t += 1 / 60) {
      mixer.update(1 / 60);
      // What ReaperModel does each frame: a finished one-shot hands back to idle.
      if (current.loop === LoopOnce && !current.isRunning()) {
        startClip(idle, current, true);
        current = idle;
      }
      peak = Math.max(peak, magnifier.scale.x);
    }
    expect(peak).toBeLessThan(0.01);
    // The finished one-shot faded out completely.
    mixer.update(FADE * 2);
    expect(nod.isRunning()).toBe(false);
    expect(nod.getEffectiveWeight()).toBe(0);
  });
});

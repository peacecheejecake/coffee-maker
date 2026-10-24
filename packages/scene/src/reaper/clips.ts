import { LoopOnce, LoopRepeat, type AnimationAction } from 'three';

/** Cross-fade length between reaper clips, seconds. */
export const FADE = 0.15;

/**
 * Starts `action`, cross-fading from `previous` (null for the very first clip).
 *
 * A one-shot holds its last frame (the rest pose) once finished, so it keeps its weight until the next clip
 * has faded in. Unclamped, three.js disables it on its last frame and the mixer fills the missing weight
 * with the bind pose for the whole fade; the bind pose holds the magnifier out at full size, so it flashed
 * up after every stamp, nod and idle fidget.
 */
export function startClip(action: AnimationAction, previous: AnimationAction | null, loop: boolean) {
  action.reset();
  action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  // The very first clip starts at full weight: a fade from the bind pose would show it (magnifier and
  // all) for as long as frames are not being rendered.
  if (previous) {
    action.fadeIn(FADE).play();
    previous.fadeOut(FADE);
  } else {
    action.setEffectiveWeight(1).play();
  }
}

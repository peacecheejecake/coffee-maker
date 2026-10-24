import { useEffect, type RefObject } from 'react';
import type { CameraHandle } from './CameraRig';
import { DRAG_THRESHOLD } from './orbit';

/** Radians per pixel dragged. */
const ORBIT_SPEED = 0.006;

/**
 * Mouse/touch camera input on `element`: one-pointer drag orbits, a two-finger pinch or the wheel zooms.
 * A press only becomes a drag past DRAG_THRESHOLD pixels; `onDrag` fires once then, so the caller can
 * swallow the click that follows (taps on towers keep working).
 */
export function useOrbitInput(element: RefObject<HTMLElement | null>, camera: RefObject<CameraHandle | null>, onDrag: () => void) {
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let dragging = false;
    let pinch = 0;

    const spread = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        dragging = false;
      }
      pinch = spread();
    };
    // On window: a drag keeps going over the HUD or outside the canvas.
    const move = (e: PointerEvent) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last.x = e.clientX;
      last.y = e.clientY;
      if (!dragging && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD) {
        dragging = true;
        onDrag();
      }
      if (pointers.size >= 2) {
        const d = spread();
        if (pinch > 0 && d > 0) camera.current?.zoomBy(pinch / d);
        pinch = d;
        if (!dragging) {
          dragging = true;
          onDrag();
        }
      } else if (dragging) {
        camera.current?.orbitBy(-dx * ORBIT_SPEED, dy * ORBIT_SPEED);
      }
    };
    const up = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      pinch = spread();
      // Lifting one finger of a pinch must not turn the other into an orbit jump.
      const rest = [...pointers.values()][0];
      if (rest) start = { ...rest };
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // Trackpad pinch arrives as ctrl+wheel with small deltas; lines/pages are much coarser than pixels.
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      camera.current?.zoomBy(Math.exp(px * (e.ctrlKey ? 0.01 : 0.0015)));
    };

    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [element, camera, onDrag]);
}

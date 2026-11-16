import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { busy, whenSafe } from '../src/swUpdate';

/** Just enough of a Document for the update scheduling: visibility, an open dialog, the focused element. */
function fakeDoc(init: { hidden?: boolean; dialog?: boolean; focused?: string } = {}) {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: init.hidden ? 'hidden' : 'visible',
    dialog: !!init.dialog,
    activeElement: init.focused ? { tagName: init.focused, isContentEditable: false } : null,
    querySelector: () => (doc.dialog ? {} : null),
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    setHidden(hidden: boolean) {
      doc.visibilityState = hidden ? 'hidden' : 'visible';
      for (const fn of [...listeners]) fn();
    },
    listeners,
  };
  return doc;
}
const asDoc = (d: ReturnType<typeof fakeDoc>) => d as unknown as Document;

describe('busy', () => {
  it('is busy with a sheet open or while typing, never when the app is out of sight', () => {
    expect(busy(asDoc(fakeDoc()))).toBe(false);
    expect(busy(asDoc(fakeDoc({ focused: 'BUTTON' })))).toBe(false);
    expect(busy(asDoc(fakeDoc({ dialog: true })))).toBe(true);
    expect(busy(asDoc(fakeDoc({ focused: 'INPUT' })))).toBe(true);
    expect(busy(asDoc(fakeDoc({ focused: 'TEXTAREA' })))).toBe(true);
    expect(busy(asDoc(fakeDoc({ hidden: true, dialog: true, focused: 'INPUT' })))).toBe(false);
  });
});

describe('whenSafe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies at once when nothing is going on', () => {
    const apply = vi.fn();
    whenSafe(apply, () => false, asDoc(fakeDoc()));
    expect(apply).toHaveBeenCalledOnce();
  });

  it('waits for the sheet to close, then applies once', () => {
    const doc = fakeDoc({ dialog: true });
    const apply = vi.fn();
    whenSafe(apply, () => busy(asDoc(doc)), asDoc(doc));
    vi.advanceTimersByTime(10_000);
    expect(apply).not.toHaveBeenCalled();
    doc.dialog = false;
    vi.advanceTimersByTime(2_000);
    vi.advanceTimersByTime(10_000);
    expect(apply).toHaveBeenCalledOnce();
    expect(doc.listeners.size).toBe(0);
  });

  it('applies when the app goes to the background, even mid-sheet', () => {
    const doc = fakeDoc({ dialog: true });
    const apply = vi.fn();
    whenSafe(apply, () => busy(asDoc(doc)), asDoc(doc));
    doc.setHidden(true);
    expect(apply).toHaveBeenCalledOnce();
  });
});

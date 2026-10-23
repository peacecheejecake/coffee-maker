/**
 * Device capabilities the UI uses, so the same screens run in a browser and inside the native shell
 * (apps/mobile swaps in Capacitor plugins). PLAN.md M7.
 */
export interface Platform {
  /** Short vibration; strength grows as the stamp gauge fills. */
  haptic(strength: 'light' | 'medium' | 'heavy'): void;
  canShare(data: ShareData): boolean;
  /** Resolves false when sharing was unavailable or cancelled. */
  share(data: ShareData): Promise<boolean>;
  /** Native camera / photo library. Absent on the web: the UI falls back to a file input. */
  pickPhoto?: () => Promise<Blob | null>;
  /** Daily local "don't be late" reminder (native only). */
  reminder?: {
    enabled(): Promise<boolean>;
    /** `at` is HH:mm local time. Resolves to the resulting state (false if permission was refused). */
    set(on: boolean, at: string, text: { title: string; body: string }): Promise<boolean>;
  };
}

const VIBRATION_MS = { light: 8, medium: 16, heavy: 40 } as const;

export const webPlatform: Platform = {
  haptic: (strength) => void navigator.vibrate?.(VIBRATION_MS[strength]),
  canShare: (data) => typeof navigator.canShare === 'function' && navigator.canShare(data),
  async share(data) {
    if (typeof navigator.share !== 'function') return false;
    try {
      await navigator.share(data);
      return true;
    } catch {
      return false;
    }
  },
};

import type { GeolocationPort, LocateFailure } from '@coffee/app';

/** GeolocationPositionError codes (named constants are not defined outside browsers). */
const FAILURE: Record<number, LocateFailure> = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

/**
 * The browser Geolocation API. It also serves the native shell: the iOS/Android web views forward it to the OS
 * location service once the app declares the permission (apps/mobile, docs/DESIGN.md §2.7).
 */
export function createBrowserGeolocation(
  geo: Geolocation | undefined = typeof navigator === 'undefined' ? undefined : navigator.geolocation,
): GeolocationPort {
  return {
    supported: () => !!geo,
    current: () =>
      new Promise((resolve) => {
        if (!geo) return resolve({ ok: false, reason: 'unsupported' });
        geo.getCurrentPosition(
          (p) => resolve({ ok: true, fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracyMeters: p.coords.accuracy } }),
          (e) => resolve({ ok: false, reason: FAILURE[e.code] ?? 'unavailable' }),
          // A reading from the last half minute is as good as a new one and saves a GPS wake-up per app switch.
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
        );
      }),
  };
}

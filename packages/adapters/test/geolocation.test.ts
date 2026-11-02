import { describe, expect, it } from 'vitest';
import { createBrowserGeolocation } from '../src/geolocation';

/** Just enough of the Geolocation API to answer one getCurrentPosition call. */
function fakeGeo(answer: { coords: Partial<GeolocationCoordinates> } | { code: number }) {
  let options: PositionOptions | undefined;
  const geo = {
    getCurrentPosition(ok: PositionCallback, fail?: PositionErrorCallback | null, opts?: PositionOptions) {
      options = opts;
      if ('coords' in answer) ok(answer as GeolocationPosition);
      else fail?.(answer as GeolocationPositionError);
    },
  } as unknown as Geolocation;
  return { geo, options: () => options };
}

describe('browser geolocation', () => {
  it('maps a position to a fix and asks for a precise, recent reading', async () => {
    const f = fakeGeo({ coords: { latitude: 37.5, longitude: 127, accuracy: 12 } });
    const port = createBrowserGeolocation(f.geo);
    expect(port.supported()).toBe(true);
    expect(await port.current()).toEqual({ ok: true, fix: { lat: 37.5, lng: 127, accuracyMeters: 12 } });
    expect(f.options()).toMatchObject({ enableHighAccuracy: true, maximumAge: 30_000 });
  });

  it('maps errors to reasons and never rejects', async () => {
    expect(await createBrowserGeolocation(fakeGeo({ code: 1 }).geo).current()).toEqual({ ok: false, reason: 'denied' });
    expect(await createBrowserGeolocation(fakeGeo({ code: 3 }).geo).current()).toEqual({ ok: false, reason: 'timeout' });
    expect(await createBrowserGeolocation(fakeGeo({ code: 9 }).geo).current()).toEqual({ ok: false, reason: 'unavailable' });
    const none = createBrowserGeolocation(undefined);
    expect(none.supported()).toBe(false);
    expect(await none.current()).toEqual({ ok: false, reason: 'unsupported' });
  });
});

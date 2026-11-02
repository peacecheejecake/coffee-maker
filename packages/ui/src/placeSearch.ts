export interface PlaceHit {
  name: string;
  lat: number;
  lng: number;
}

/** Address / place-name lookup for the workplace picker; injectable so tests need no network. */
export type PlaceSearch = (query: string, signal?: AbortSignal) => Promise<PlaceHit[]>;

/**
 * OpenStreetMap's Nominatim. Its usage policy allows light use like this (an explicit search, never as-you-type,
 * at most one request per second) with attribution, which the map already shows.
 */
export const nominatimSearch: PlaceSearch = async (query, signal) => {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ko&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: signal ?? null, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  const rows = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
  return rows
    .map((r) => ({ name: r.display_name ?? '', lat: Number(r.lat), lng: Number(r.lon) }))
    .filter((h) => h.name && Number.isFinite(h.lat) && Number.isFinite(h.lng));
};

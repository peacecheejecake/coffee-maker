import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface WorkplaceMapProps {
  /** The chosen center, or null before anything is chosen (the map then shows `fallback`). */
  center: LatLng | null;
  fallback: LatLng;
  radiusMeters: number;
  onPick: (at: LatLng) => void;
  label: string;
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * Leaflet + OpenStreetMap tiles; loaded lazily (WorkplaceSheet) so the ~40 kB library is fetched only by whoever
 * opens the workplace picker. Tapping the map moves the center.
 */
export function WorkplaceMap({ center, fallback, radiusMeters, onPick, label }: WorkplaceMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const area = useRef<L.Circle | null>(null);
  const dot = useRef<L.CircleMarker | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: true, attributionControl: true }).setView(center ?? fallback, center ? 16 : 13);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => pick.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = area.current = dot.current = null;
    };
    // Created once; later changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!center) {
      area.current?.remove();
      dot.current?.remove();
      area.current = dot.current = null;
      return;
    }
    if (!area.current) {
      area.current = L.circle(center, { radius: radiusMeters, color: '#f2a65a', weight: 2, fillOpacity: 0.15 }).addTo(m);
      dot.current = L.circleMarker(center, { radius: 6, color: '#23170c', weight: 2, fillColor: '#f2a65a', fillOpacity: 1 }).addTo(m);
    } else {
      area.current.setLatLng(center).setRadius(radiusMeters);
      dot.current?.setLatLng(center);
    }
    // Keep the whole area in view when it moves (current location, a search hit) or grows.
    const bounds = area.current.getBounds();
    if (!m.getBounds().contains(bounds)) m.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
  }, [center, radiusMeters]);

  return <div ref={el} className="cm-map" role="application" aria-label={label} />;
}

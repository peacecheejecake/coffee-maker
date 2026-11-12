import type { LatLng } from '@coffee/core';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { canInsertVertex, canRemoveVertex, insertVertex, midpoints, moveVertex, removeVertex } from './polygonEdit';

export type { LatLng };

export type MapArea = { kind: 'circle'; center: LatLng; radiusMeters: number } | { kind: 'polygon'; points: LatLng[] };

export interface WorkplaceMapProps {
  /** The area being edited, or null before anything is chosen (the map then shows `fallback`). */
  area: MapArea | null;
  fallback: LatLng;
  /** Circle: a tap moves the center there. */
  onPick: (at: LatLng) => void;
  /** Polygon: vertices dragged, inserted (midpoint handles) or removed (long-press). */
  onPointsChange: (points: LatLng[]) => void;
  /** Polygon: the vertex the sheet's delete button acts on. */
  selected: number | null;
  onSelect: (index: number | null) => void;
  labels: { map: string; vertex: (n: number) => string; insert: string; expand: string; collapse: string };
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
/** The chosen area, in a bright yellow that stands out on the map tiles (the vertex handles match, see ui.css). */
const AREA_COLOR = '#ffd400';
const STROKE = { color: AREA_COLOR, weight: 3, fillOpacity: 0.3 };

// Handles are 28 px (vertices) and 22 px (insert) so they can be grabbed with a finger; the visible dot is smaller (ui.css).
const vertexIcon = (selected: boolean) =>
  L.divIcon({ className: `cm-vertex${selected ? ' is-selected' : ''}`, iconSize: [28, 28], iconAnchor: [14, 14] });
const insertIcon = L.divIcon({ className: 'cm-vertex-insert', iconSize: [22, 22], iconAnchor: [11, 11], html: '+' });

/**
 * Leaflet + OpenStreetMap tiles; loaded lazily (WorkplaceSheet) so the library is fetched only by whoever opens the
 * workplace picker. A small hand-rolled polygon editor: drag vertices, tap or drag a "+" handle on an edge to add
 * one, long-press a vertex (or select it and use the sheet's button) to remove it.
 */
export function WorkplaceMap({ area, fallback, onPick, onPointsChange, selected, onSelect, labels }: WorkplaceMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const shapes = useRef<L.LayerGroup | null>(null);
  // The area last brought into view: re-renders that leave it unchanged must not pull the map back to it.
  const fitted = useRef<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Leaflet handlers are bound once; they read the latest props through this ref.
  const props = useRef({ area, onPick, onPointsChange, onSelect });
  props.current = { area, onPick, onPointsChange, onSelect };

  useEffect(() => {
    const start = area ? (area.kind === 'circle' ? area.center : area.points[0]!) : fallback;
    const m = L.map(el.current!, { zoomControl: true, attributionControl: true }).setView(start, area ? 16 : 13);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      const { area: a, onPick: pick, onSelect: select } = props.current;
      if (a?.kind === 'polygon') select(null);
      else pick({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    map.current = m;
    shapes.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = shapes.current = null;
    };
    // Created once; later changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    const group = shapes.current;
    if (!m || !group) return;
    group.clearLayers();
    if (!area) return;
    let outline: L.Circle | L.Polygon;
    if (area.kind === 'circle') {
      outline = L.circle(area.center, { ...STROKE, radius: area.radiusMeters }).addTo(group);
      L.circleMarker(area.center, { radius: 6, color: '#23170c', weight: 2, fillColor: AREA_COLOR, fillOpacity: 1 }).addTo(group);
    } else {
      const polygon = L.polygon(area.points, STROKE).addTo(group);
      outline = polygon;
      const inserts = canInsertVertex(area.points)
        ? midpoints(area.points).map((mid, i) => {
            const handle = L.marker(mid, { icon: insertIcon, draggable: true, title: labels.insert, keyboard: true }).addTo(group);
            const insert = (at?: LatLng) => {
              props.current.onPointsChange(insertVertex(area.points, i, at));
              props.current.onSelect(i + 1);
            };
            handle.on('click', () => insert());
            handle.on('dragend', () => insert(handle.getLatLng()));
            return handle;
          })
        : [];
      area.points.forEach((p, i) => {
        const icon = vertexIcon(i === selected);
        const vertex = L.marker(p, { icon, draggable: true, title: labels.vertex(i + 1), keyboard: true }).addTo(group);
        vertex.on('click', () => props.current.onSelect(i));
        // Insert handles would point at stale edges mid-drag; the outline follows the finger instead.
        vertex.on('dragstart', () => inserts.forEach((h) => h.setOpacity(0)));
        vertex.on('drag', () => polygon.setLatLngs(area.points.map((q, j) => (j === i ? vertex.getLatLng() : q))));
        vertex.on('dragend', () => {
          props.current.onPointsChange(moveVertex(area.points, i, vertex.getLatLng()));
          props.current.onSelect(i);
        });
        // Long-press on touch screens (Leaflet turns it into contextmenu), right-click with a mouse.
        vertex.on('contextmenu', () => {
          if (!canRemoveVertex(area.points)) return;
          props.current.onPointsChange(removeVertex(area.points, i));
          props.current.onSelect(null);
        });
      });
    }
    // Keep the whole area in view when it moves (current location, a search hit, a new shape) or grows, but only
    // then: someone panning elsewhere stays there.
    const key = JSON.stringify(area);
    if (key === fitted.current) return;
    fitted.current = key;
    const bounds = outline.getBounds();
    if (!m.getBounds().contains(bounds)) m.fitBounds(bounds, { padding: [32, 32], maxZoom: 17 });
  }, [area, selected, labels]);

  // Leaflet measures its container once; tell it the size changed.
  useEffect(() => {
    map.current?.invalidateSize();
  }, [expanded]);

  return (
    <div className={`cm-map-frame${expanded ? ' is-expanded' : ''}`}>
      <div ref={el} className="cm-map" role="application" aria-label={labels.map} />
      <button
        type="button"
        className="cm-map-toggle"
        aria-pressed={expanded}
        title={expanded ? labels.collapse : labels.expand}
        onClick={() => setExpanded((x) => !x)}
      >
        {expanded ? labels.collapse : labels.expand}
      </button>
    </div>
  );
}

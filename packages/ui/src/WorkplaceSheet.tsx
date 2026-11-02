import {
  areaCenter,
  areaRadius,
  DEFAULT_WORKPLACE_RADIUS,
  isPolygonArea,
  movePolygon,
  regularPolygon,
  workplaceIssues,
  WORKPLACE_LIMITS,
  type LatLng,
  type Workplace,
} from '@coffee/core';
import type { MessageKey } from '@coffee/theme';
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStoreApi, useT } from './context';
import { nominatimSearch, type PlaceHit, type PlaceSearch } from './placeSearch';
import { canRemoveVertex, removeVertex, roundLatLng } from './polygonEdit';
import { Field, Segmented, Sheet, Stepper } from './primitives';
import type { MapArea } from './WorkplaceMap';

const WorkplaceMap = lazy(() => import('./WorkplaceMap').then((m) => ({ default: m.WorkplaceMap })));

/** Where the map opens when there is neither a workplace nor a position: Seoul City Hall. */
const FALLBACK: LatLng = { lat: 37.5665, lng: 126.978 };
/** A circle turned into a polygon starts as a hexagon of the same size: few enough handles to drag on a phone. */
const START_SIDES = 6;

type Shape = 'circle' | 'polygon';

/** Polygon validation messages, worded for people (the paths come from `workplaceIssues`). */
const POLYGON_ISSUE: Record<string, MessageKey> = {
  'edges cross': 'workplace.issue.cross',
  'too large': 'workplace.issue.large',
  'too small': 'workplace.issue.small',
};

const clampRadius = (m: number) => {
  const { min, max } = WORKPLACE_LIMITS.radiusMeters;
  return Math.min(max, Math.max(min, Math.round(m / 50) * 50));
};

/**
 * The workplace picker (출두 구역 설정). Opens on the current workplace, or on the device's position the first time.
 * A circle (center + radius) is the quick default; switching to a polygon starts from a hexagon around it, whose
 * vertices are then dragged on the map. Only edits a draft: the rules editor adopts or proposes it like any other rule.
 */
export function WorkplaceSheet({
  open,
  onOpenChange,
  value,
  onApply,
  search = nominatimSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: Workplace | undefined;
  onApply: (w: Workplace | undefined) => void;
  search?: PlaceSearch;
}) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('workplace.sheetTitle')}>
      {open && <Picker value={value} search={search} onApply={(w) => (onApply(w), onOpenChange(false))} />}
    </Sheet>
  );
}

function Picker({
  value,
  search,
  onApply,
}: {
  value: Workplace | undefined;
  search: PlaceSearch;
  onApply: (w: Workplace | undefined) => void;
}) {
  const t = useT();
  const api = useStoreApi();
  const [shape, setShape] = useState<Shape>(value && isPolygonArea(value) ? 'polygon' : 'circle');
  const [center, setCenter] = useState<LatLng | null>(value ? areaCenter(value) : null);
  const [radius, setRadius] = useState(value && !isPolygonArea(value) ? value.radiusMeters : DEFAULT_WORKPLACE_RADIUS);
  const [points, setPoints] = useState<LatLng[]>(value && isPolygonArea(value) ? value.points : []);
  const [selected, setSelected] = useState<number | null>(null);
  const [label, setLabel] = useState(value?.label ?? '');
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);

  /** Current location, a search hit, or a tap (circle only): the area moves there, keeping its shape. */
  const moveTo = (at: LatLng) => {
    const to = roundLatLng(at);
    setCenter(to);
    if (shape === 'polygon' && points.length > 0) setPoints(movePolygon(points, to).map(roundLatLng));
  };

  const switchShape = (next: Shape) => {
    if (next === shape) return;
    setSelected(null);
    if (next === 'polygon' && center) setPoints(regularPolygon(center, radius, START_SIDES).map(roundLatLng));
    if (next === 'circle' && points.length > 0) {
      const poly: Workplace = { kind: 'polygon', points };
      setCenter(roundLatLng(areaCenter(poly)));
      setRadius(clampRadius(areaRadius(poly)));
    }
    setShape(next);
  };

  const locateHere = async () => {
    setLocating(true);
    setLocateFailed(false);
    const r = await api.getState().position();
    setLocating(false);
    if (r.ok) moveTo(r.fix);
    else setLocateFailed(true);
  };

  // First time (no workplace yet): start from where the device is.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || value) return;
    started.current = true;
    void locateHere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = label.trim();
  const named = trimmed ? { label: trimmed } : {};
  const draft: Workplace | null =
    shape === 'polygon'
      ? points.length > 0
        ? { kind: 'polygon', points, ...named }
        : null
      : center && { lat: center.lat, lng: center.lng, radiusMeters: radius, ...named };
  const issue = draft && shape === 'polygon' ? workplaceIssues(draft).find(([path]) => path.startsWith('points')) : undefined;
  const area: MapArea | null =
    shape === 'polygon'
      ? points.length > 0
        ? { kind: 'polygon', points }
        : null
      : center && { kind: 'circle', center, radiusMeters: radius };
  const labels = useMemo(
    () => ({ map: t('workplace.map'), vertex: (n: number) => t('workplace.vertex', { n }), insert: t('workplace.vertexAdd') }),
    [t],
  );

  return (
    <div className="cm-stack">
      <div className="cm-row cm-wrap">
        <button type="button" className="cm-button" disabled={locating} onClick={() => void locateHere()}>
          📍 {t('workplace.current')}
        </button>
        {locating && <span className="cm-muted">{t('workplace.locating')}</span>}
      </div>
      {locateFailed && (
        <p className="cm-muted" role="status">
          {t('workplace.locateFailed')}
        </p>
      )}
      <PlaceSearchBox search={search} onPick={moveTo} />
      <Segmented<Shape>
        label={t('workplace.shape')}
        value={shape}
        disabled={!center && points.length === 0}
        options={[
          { value: 'circle', label: t('workplace.shape.circle') },
          { value: 'polygon', label: t('workplace.shape.polygon') },
        ]}
        onChange={switchShape}
      />
      <MapBoundary fallbackText={t('workplace.mapFailed')}>
        <Suspense fallback={<div className="cm-map cm-map-loading">{t('workplace.mapLoading')}</div>}>
          <WorkplaceMap
            area={area}
            fallback={FALLBACK}
            onPick={moveTo}
            onPointsChange={setPoints}
            selected={selected}
            onSelect={setSelected}
            labels={labels}
          />
        </Suspense>
      </MapBoundary>
      {shape === 'circle' ? (
        <p className="cm-muted">
          {t('workplace.mapHint')}
          {center && <> · {t('workplace.center', { lat: center.lat.toFixed(5), lng: center.lng.toFixed(5) })}</>}
        </p>
      ) : (
        <>
          <p className="cm-muted">{t('workplace.polygonHint', { count: points.length, max: WORKPLACE_LIMITS.polygonPoints.max })}</p>
          <button
            type="button"
            className="cm-button cm-button-ghost"
            disabled={selected === null || !canRemoveVertex(points)}
            onClick={() => {
              if (selected === null) return;
              setPoints(removeVertex(points, selected));
              setSelected(null);
            }}
          >
            {selected === null ? t('workplace.vertexRemove') : t('workplace.vertexRemoveN', { n: selected + 1 })}
          </button>
          {issue && (
            <p className="cm-errors" role="alert">
              {t(POLYGON_ISSUE[issue[1]] ?? 'workplace.issue.points')}
            </p>
          )}
        </>
      )}
      <div className="cm-grid2">
        {shape === 'circle' && (
          <Field label={t('workplace.radius')}>
            <Stepper label={t('workplace.radius')} value={radius} {...WORKPLACE_LIMITS.radiusMeters} step={50} onChange={setRadius} />
          </Field>
        )}
        <Field label={t('workplace.label')}>
          <input
            className="cm-input"
            value={label}
            maxLength={WORKPLACE_LIMITS.labelLength}
            placeholder={t('workplace.labelPlaceholder')}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
      </div>
      <div className="cm-row cm-wrap">
        <button type="button" className="cm-button cm-button-primary" disabled={!draft || !!issue} onClick={() => draft && onApply(draft)}>
          {t('workplace.apply')}
        </button>
        {value && (
          <button type="button" className="cm-button cm-button-ghost" onClick={() => onApply(undefined)}>
            {t('workplace.remove')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Search on submit only (the geocoder's usage policy rules out searching as one types). */
function PlaceSearchBox({ search, onPick }: { search: PlaceSearch; onPick: (h: PlaceHit) => void }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setFailed(false);
    try {
      setHits(await search(q));
    } catch {
      setHits(null);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="cm-form"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <div className="cm-row">
        <input
          className="cm-input"
          type="search"
          aria-label={t('workplace.search')}
          placeholder={t('workplace.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="cm-button" disabled={busy || !query.trim()}>
          {t('workplace.search')}
        </button>
      </div>
      {failed && <p className="cm-muted">{t('workplace.searchFailed')}</p>}
      {hits?.length === 0 && <p className="cm-muted">{t('workplace.searchEmpty')}</p>}
      {!!hits?.length && (
        <ul className="cm-list cm-place-hits">
          {hits.map((h) => (
            <li key={`${h.lat},${h.lng}`}>
              <button
                type="button"
                className="cm-button cm-button-ghost cm-place-hit"
                onClick={() => {
                  onPick(h);
                  setHits(null);
                }}
              >
                {h.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** Offline or blocked: the lazy chunk or the tiles fail to load. Current location and search still work. */
class MapBoundary extends Component<{ fallbackText: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <p className="cm-muted cm-map cm-map-loading">{this.props.fallbackText}</p> : this.props.children;
  }
}

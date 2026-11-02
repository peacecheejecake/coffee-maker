import { DEFAULT_WORKPLACE_RADIUS, WORKPLACE_LIMITS, type Workplace } from '@coffee/core';
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStoreApi, useT } from './context';
import { nominatimSearch, type PlaceHit, type PlaceSearch } from './placeSearch';
import { Field, Sheet, Stepper } from './primitives';
import type { LatLng } from './WorkplaceMap';

const WorkplaceMap = lazy(() => import('./WorkplaceMap').then((m) => ({ default: m.WorkplaceMap })));

/** Where the map opens when there is neither a workplace nor a position: Seoul City Hall. */
const FALLBACK: LatLng = { lat: 37.5665, lng: 126.978 };

/** ~10 cm: more digits are noise, and the ruleset is shown to (and voted on by) everyone. */
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The workplace picker (출두 구역 설정). Opens on the current workplace, or on the device's position the first time;
 * the center can also be moved by tapping the map or searching. Only edits a draft: the rules editor adopts or
 * proposes it like any other rule.
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
  const [center, setCenter] = useState<LatLng | null>(value ? { lat: value.lat, lng: value.lng } : null);
  const [radius, setRadius] = useState(value?.radiusMeters ?? DEFAULT_WORKPLACE_RADIUS);
  const [label, setLabel] = useState(value?.label ?? '');
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const pickAt = (at: LatLng) => setCenter({ lat: round(at.lat), lng: round(at.lng) });

  const locateHere = async () => {
    setLocating(true);
    setLocateFailed(false);
    const r = await api.getState().position();
    setLocating(false);
    if (r.ok) pickAt(r.fix);
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
  const apply = () =>
    center && onApply({ lat: center.lat, lng: center.lng, radiusMeters: radius, ...(trimmed && { label: trimmed }) });

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
      <PlaceSearchBox search={search} onPick={(h) => pickAt(h)} />
      <MapBoundary fallbackText={t('workplace.mapFailed')}>
        <Suspense fallback={<div className="cm-map cm-map-loading">{t('workplace.mapLoading')}</div>}>
          <WorkplaceMap center={center} fallback={FALLBACK} radiusMeters={radius} onPick={pickAt} label={t('workplace.map')} />
        </Suspense>
      </MapBoundary>
      <p className="cm-muted">
        {t('workplace.mapHint')}
        {center && <> · {t('workplace.center', { lat: center.lat.toFixed(5), lng: center.lng.toFixed(5) })}</>}
      </p>
      <div className="cm-grid2">
        <Field label={t('workplace.radius')}>
          <Stepper label={t('workplace.radius')} value={radius} {...WORKPLACE_LIMITS.radiusMeters} step={50} onChange={setRadius} />
        </Field>
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
        <button type="button" className="cm-button cm-button-primary" disabled={!center} onClick={apply}>
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

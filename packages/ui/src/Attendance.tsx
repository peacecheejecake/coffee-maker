import type { PlaceStatus } from '@coffee/app';
import { checkInBlocker, type CheckInBlocker, type Decision } from '@coffee/core';
import type { Translate } from '@coffee/theme';
import { useCallback, useEffect } from 'react';
import { useLedger, useStoreApi, useT, useUi } from './context';
import { formatDistance, formatWorkDate } from './format';

const SETTLE_EVERY_MS = 60_000;
/** How often an open app re-reads the position while a check-in is still due (GPS costs battery). */
const LOCATE_EVERY_MS = 2 * 60_000;

/** Keeps missed days settled while the app is open (the store waits until the ledger is in sync). */
export function useSettleAttendance() {
  const settle = useLedger((s) => s.settleAttendance);
  const mode = useLedger((s) => s.ledger.mode);
  const startsOn = useLedger((s) => s.ledger.attendance.startsOn);
  useEffect(() => {
    if (mode !== 'attendance' || !startsOn) return;
    void settle();
    const timer = setInterval(() => void settle(), SETTLE_EVERY_MS);
    return () => clearInterval(timer);
  }, [settle, mode, startsOn]);
}

/**
 * While a check-in is due and the rules set a workplace: reads the position when the app opens or comes back to
 * the foreground (and every few minutes), so the button can say where one is. With auto check-in on, a reading
 * inside the area checks in right away. Nothing runs while the app is closed or hidden.
 */
export function useWorkplaceWatch() {
  const api = useStoreApi();
  const me = useLedger((s) => s.me);
  const ledger = useLedger((s) => s.ledger);
  // An auto check-in waits for the ledger to sync (see tryAutoCheckIn); this retries it once it has.
  const synced = useLedger((s) => s.sync === 'local' || s.sync === 'synced');
  const auto = useLedger((s) => s.autoCheckIn);
  const today = useLedger((s) => s.wallNow)().workDate;
  const workplace = useLedger((s) => s.workplaceToday)();
  const due = !!me && !!workplace && api.supportsLocation && checkInBlocker(ledger, me, today) === null;
  const key = JSON.stringify(workplace ?? null);
  const announce = useCheckInToast(true);

  useEffect(() => {
    if (!due) return;
    const tick = async () => {
      if (document.visibilityState === 'hidden') return;
      const st = api.getState();
      if (!auto) return void st.locate();
      const d = await st.tryAutoCheckIn();
      if (d) announce(d);
    };
    void tick();
    const onVisible = () => document.visibilityState === 'visible' && void tick();
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void tick(), LOCATE_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [api, due, auto, key, synced, announce]);
}

/** Toast for a check-in that went through: on time, or how late and what it cost. */
function useCheckInToast(auto: boolean) {
  const t = useT();
  const { toast } = useUi();
  const api = useStoreApi();
  return useCallback(
    (d: Decision) => {
      const e = d.ok ? d.value[0] : undefined;
      if (!e) return;
      const rec = api.getState().ledger.lates[e.id];
      if (rec) toast(t(auto ? 'checkin.autoLate' : 'checkin.late', { minutes: rec.minutesLate, cups: rec.cups }));
      else toast(t(auto ? 'checkin.autoOnTime' : 'checkin.onTime'));
    },
    [api, t, toast, auto],
  );
}

const BLOCKER_LABEL: Record<Exclude<CheckInBlocker, 'wrongMode' | 'notStarted'>, Parameters<Translate>[0]> = {
  notAdopted: 'checkin.waiting',
  checkedIn: 'checkin.done',
  missed: 'checkin.missed',
  dayOff: 'checkin.dayOff',
  spectator: 'checkin.spectator',
};

/** Why the workplace keeps the button disabled, or null when the last reading was inside. */
function placeLabel(t: Translate, place: PlaceStatus | null, supported: boolean): string | null {
  if (!supported) return t('checkin.noLocation');
  if (!place || place.kind === 'locating') return t('checkin.locating');
  switch (place.kind) {
    case 'inside':
      return null;
    case 'outside':
      return t('checkin.outside', { distance: formatDistance(place.distanceMeters) });
    case 'uncertain':
      return t('checkin.uncertain', { accuracy: formatDistance(place.accuracyMeters) });
    case 'failed':
      if (place.reason === 'denied') return t('checkin.locationDenied');
      return t(place.reason === 'unsupported' ? 'checkin.noLocation' : 'checkin.locationUnavailable');
  }
}

/** The attendance-mode main action. Explains why it is unavailable instead of hiding. */
export function CheckInButton() {
  const t = useT();
  const { toast } = useUi();
  const api = useStoreApi();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const place = useLedger((s) => s.place);
  const today = useLedger((s) => s.wallNow)().workDate;
  const workplace = useLedger((s) => s.workplaceToday)();
  const announce = useCheckInToast(false);
  if (!me) return null;

  const blocker = checkInBlocker(ledger, me, today);
  let disabledLabel: string | null = null;
  if (blocker === 'notStarted') disabledLabel = t('checkin.startsOn', { date: formatWorkDate(ledger.attendance.startsOn!) });
  else if (blocker && blocker !== 'wrongMode') disabledLabel = t(BLOCKER_LABEL[blocker]);
  // Only when nothing else stands in the way does it matter where one is.
  const placeBlock = blocker === null && workplace ? placeLabel(t, place, api.supportsLocation) : null;

  async function checkIn() {
    const d = await api.getState().checkIn();
    if (d.ok) return announce(d);
    // Location refusals already show on the button; anything else (e.g. a check-in from another device) is news.
    if (!['LocationRequired', 'OutsideWorkplace', 'LocationUncertain'].includes(d.error.code)) toast(t(`error.${d.error.code}`), 'error');
  }

  const canRelocate = placeBlock !== null && api.supportsLocation && place?.kind !== 'locating';
  return (
    <>
      <button
        type="button"
        className="cm-button cm-button-primary cm-button-large"
        disabled={disabledLabel !== null || placeBlock !== null}
        onClick={() => void checkIn()}
      >
        🕯 {disabledLabel ?? placeBlock ?? t('checkin.action')}
      </button>
      {canRelocate && (
        <button
          type="button"
          className="cm-button cm-button-large cm-button-secondary cm-button-round"
          aria-label={t('checkin.relocate')}
          title={t('checkin.relocate')}
          onClick={() => void api.getState().locate()}
        >
          📍
        </button>
      )}
    </>
  );
}

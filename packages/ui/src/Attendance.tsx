import type { PlaceStatus } from '@coffee/app';
import { CHECKIN_QR_PARAM, checkInBlocker, parseCheckInQr, type CheckInBlocker, type Decision } from '@coffee/core';
import type { Translate } from '@coffee/theme';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLedger, useStoreApi, useT, useUi } from './context';
import { formatDistance, formatWorkDate } from './format';
import { QrScannerSheet } from './QrScanner';

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

/** Codes the decide step reports on the button itself rather than in a toast. */
const SHOWN_ON_BUTTON = ['LocationRequired', 'OutsideWorkplace', 'LocationUncertain'];

/** Takes the check-in code out of the address (a QR opened with the phone's own camera), once per page load. */
function takeLinkCode(): string | null {
  if (typeof location === 'undefined') return null;
  const params = new URLSearchParams(location.search);
  const raw = params.get(CHECKIN_QR_PARAM);
  if (raw === null) return null;
  params.delete(CHECKIN_QR_PARAM);
  const rest = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  return parseCheckInQr(raw);
}

/**
 * A check-in QR scanned with the phone's camera opens the app with the code in the address: check in with it as
 * soon as the ledger is in sync (so a check-in from another device is known), or say why not.
 */
export function useCheckInLink() {
  const t = useT();
  const { toast } = useUi();
  const api = useStoreApi();
  const me = useLedger((s) => s.me);
  const synced = useLedger((s) => s.sync === 'local' || s.sync === 'synced');
  const code = useRef<string | null | undefined>(undefined);
  if (code.current === undefined) code.current = takeLinkCode();
  const announce = useCheckInToast(false);

  useEffect(() => {
    const scanned = code.current;
    if (!scanned || !me || !synced) return;
    code.current = null;
    const st = api.getState();
    const blocker = checkInBlocker(st.ledger, me, st.wallNow().workDate);
    if (blocker === 'notStarted' || blocker === 'wrongMode') return;
    if (blocker) return toast(t(BLOCKER_LABEL[blocker]));
    void st.checkIn(scanned).then((d) => {
      if (d.ok) return announce(d);
      if (!SHOWN_ON_BUTTON.includes(d.error.code)) toast(t(`error.${d.error.code}`), 'error');
    });
  }, [api, me, synced, announce, toast, t]);
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
  const qr = useLedger((s) => s.qrRequiredToday)();
  const announce = useCheckInToast(false);
  const [scanning, setScanning] = useState(false);
  if (!me) return null;

  const blocker = checkInBlocker(ledger, me, today);
  let disabledLabel: string | null = null;
  if (blocker === 'notStarted') disabledLabel = t('checkin.startsOn', { date: formatWorkDate(ledger.attendance.startsOn!) });
  else if (blocker && blocker !== 'wrongMode') disabledLabel = t(BLOCKER_LABEL[blocker]);
  // Only when nothing else stands in the way does it matter where one is.
  const placeBlock = blocker === null && workplace ? placeLabel(t, place, api.supportsLocation) : null;

  async function checkIn(qrCode?: string) {
    setScanning(false);
    const d = await api.getState().checkIn(qrCode);
    if (d.ok) return announce(d);
    // Location refusals already show on the button; anything else (e.g. a check-in from another device) is news.
    if (!SHOWN_ON_BUTTON.includes(d.error.code)) toast(t(`error.${d.error.code}`), 'error');
  }

  const canRelocate = placeBlock !== null && api.supportsLocation && place?.kind !== 'locating';
  return (
    <>
      <button
        type="button"
        className="cm-button cm-button-primary cm-button-large"
        disabled={disabledLabel !== null || placeBlock !== null}
        onClick={() => (qr ? setScanning(true) : void checkIn())}
      >
        {qr ? '🔳' : '🕯'} {disabledLabel ?? placeBlock ?? t(qr ? 'checkin.scan' : 'checkin.action')}
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
      {qr && <QrScannerSheet open={scanning} onOpenChange={setScanning} onCode={(code) => void checkIn(code)} />}
    </>
  );
}

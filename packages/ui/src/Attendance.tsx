import { attendanceOn, isWorkdayFor, rulesetAt } from '@coffee/core';
import { useEffect } from 'react';
import { useCommand, useLedger, useStoreApi, useT, useUi } from './context';
import { formatWorkDate } from './format';

const SETTLE_EVERY_MS = 60_000;

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

/** The attendance-mode main action. Explains why it is unavailable instead of hiding. */
export function CheckInButton() {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const api = useStoreApi();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const today = useLedger((s) => s.wallNow)().workDate;
  if (!me) return null;

  const { startsOn } = ledger.attendance;
  const settled = attendanceOn(ledger, me, today);
  let disabledLabel: string | null = null;
  if (!startsOn) disabledLabel = t('checkin.waiting');
  else if (today < startsOn) disabledLabel = t('checkin.startsOn', { date: formatWorkDate(startsOn) });
  else if (settled === 'checkIn') disabledLabel = t('checkin.done');
  else if (settled === 'missed') disabledLabel = t('checkin.missed');
  else if (!isWorkdayFor(ledger, rulesetAt(ledger, today), me, today)) disabledLabel = t('checkin.dayOff');

  async function checkIn() {
    const d = await run({ type: 'CheckIn' });
    const e = d.ok ? d.value[0] : undefined;
    if (!e) return;
    const rec = api.getState().ledger.lates[e.id];
    toast(rec ? t('checkin.late', { minutes: rec.minutesLate, cups: rec.cups }) : t('checkin.onTime'));
  }

  return (
    <button
      type="button"
      className="cm-button cm-button-primary cm-button-large"
      disabled={disabledLabel !== null}
      onClick={() => void checkIn()}
    >
      🕯 {disabledLabel ?? t('checkin.action')}
    </button>
  );
}

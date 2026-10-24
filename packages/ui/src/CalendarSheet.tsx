import { addDays, currentRuleset, holidayOn, type Command, type WorkDate } from '@coffee/core';
import { useState } from 'react';
import { useCommand, useLedger, useT, useUi } from './context';
import { formatWorkDate } from './format';
import { useMotionFeedback } from './Motions';
import { Field, Sheet } from './primitives';

const UPCOMING_DAYS = 90;

/** Holidays for the group and the viewer's own vacations, both registrable after the fact. */
export function CalendarSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('calendar.title')}>
      {open && (
        <div className="cm-stack">
          <Holidays />
          <Vacations />
        </div>
      )}
    </Sheet>
  );
}

function Holidays() {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const feedback = useMotionFeedback();
  const ledger = useLedger((s) => s.ledger);
  const today = useLedger((s) => s.wallNow)().workDate;
  const [date, setDate] = useState<WorkDate>('');
  const [name, setName] = useState('');
  const byVote = ledger.mode === 'attendance';
  const rs = currentRuleset(ledger);

  const upcoming: { date: WorkDate; name: string }[] = [];
  for (let d = today; d <= addDays(today, UPCOMING_DAYS); d = addDays(d, 1)) {
    const holiday = holidayOn(ledger, rs, d);
    if (holiday) upcoming.push({ date: d, name: holiday });
  }

  async function submit(date: WorkDate, name: string, off: boolean) {
    const cmd: Command = byVote
      ? { type: 'ProposeMotion', motion: { kind: 'holiday', date, name, off } }
      : { type: 'SetHoliday', date, name, off };
    const d = await run(cmd);
    if (!d.ok) return false;
    if (byVote) feedback(d.value[0]?.id);
    else toast(t('calendar.saved'));
    return true;
  }

  return (
    <section className="cm-section" aria-labelledby="holidays-h">
      <h3 id="holidays-h">{t('calendar.holidays')}</h3>
      <p className="cm-muted">
        {t('calendar.publicHolidays')}:{' '}
        {(rs.publicHolidays ?? 'KR') === 'KR' ? t('calendar.publicHolidays.on') : t('calendar.publicHolidays.off')}
      </p>
      {byVote && <p className="cm-muted">{t('calendar.byVote')}</p>}
      <h4 className="cm-field-label">{t('calendar.upcoming')}</h4>
      {upcoming.length === 0 ? (
        <p className="cm-muted">{t('calendar.none')}</p>
      ) : (
        <ul className="cm-list cm-date-list">
          {upcoming.map((h) => (
            <li key={h.date} className="cm-date-row">
              <span>
                {formatWorkDate(h.date)} · {h.name}
              </span>
              <button type="button" className="cm-button cm-button-ghost" onClick={() => void submit(h.date, h.name, false)}>
                {t('calendar.cancelHoliday')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="cm-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await submit(date, name, true)) {
            setDate('');
            setName('');
          }
        }}
      >
        <div className="cm-row cm-row-fill">
          <Field label={t('calendar.date')}>
            <input className="cm-input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('calendar.name')}>
            <input className="cm-input" required maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <button type="submit" className="cm-button" disabled={!date || !name.trim()}>
          {t('calendar.addHoliday')}
        </button>
      </form>
    </section>
  );
}

function Vacations() {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const me = useLedger((s) => s.me);
  const dates = useLedger((s) => (s.me ? s.ledger.vacations[s.me] : undefined)) ?? [];
  const [date, setDate] = useState<WorkDate>('');
  if (!me) return null;

  async function set(date: WorkDate, on: boolean) {
    const d = await run({ type: 'SetVacation', date, on });
    if (d.ok) toast(t('calendar.saved'));
    return d.ok;
  }

  return (
    <section className="cm-section" aria-labelledby="vacations-h">
      <h3 id="vacations-h">{t('calendar.vacations')}</h3>
      {dates.length === 0 ? (
        <p className="cm-muted">{t('calendar.noVacations')}</p>
      ) : (
        <ul className="cm-list cm-date-list">
          {[...dates].reverse().map((d) => (
            <li key={d} className="cm-date-row">
              <span>{formatWorkDate(d)}</span>
              <button type="button" className="cm-button cm-button-ghost" onClick={() => void set(d, false)}>
                {t('calendar.removeVacation')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="cm-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await set(date, true)) setDate('');
        }}
      >
        <Field label={t('calendar.date')} hint={t('calendar.retroHint')}>
          <input className="cm-input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <button type="submit" className="cm-button" disabled={!date}>
          {t('calendar.addVacation')}
        </button>
      </form>
    </section>
  );
}

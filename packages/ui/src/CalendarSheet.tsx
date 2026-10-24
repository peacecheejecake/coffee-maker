import {
  addDays,
  currentRuleset,
  holidayOn,
  isSoloMember,
  isWeekend,
  motionsOpen,
  onVacation,
  weekday,
  type Command,
  type WorkDate,
} from '@coffee/core';
import { useEffect, useState } from 'react';
import { useCommand, useLedger, useT, useUi } from './context';
import { formatWorkDate } from './format';
import { useMotionFeedback } from './Motions';
import { Field, Segmented, Sheet } from './primitives';

const UPCOMING_DAYS = 90;

type View = 'month' | 'list';

/** Holidays for the group and the viewer's own vacations on a month grid; the plain lists sit under "목록". */
export function CalendarSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const [view, setView] = useState<View>('month');
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('calendar.title')}>
      {open && (
        <div className="cm-stack">
          <Segmented<View>
            label={t('calendar.view')}
            value={view}
            options={[
              { value: 'month', label: t('calendar.view.month') },
              { value: 'list', label: t('calendar.view.list') },
            ]}
            onChange={setView}
          />
          {view === 'month' ? (
            <MonthView />
          ) : (
            <>
              <HolidayList />
              <VacationList />
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Holidays change by motion in attendance mode (passing at once when nobody else votes), directly in the shared ledger. */
function useHolidayCommand() {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const feedback = useMotionFeedback();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const byMotion = ledger.mode === 'attendance';
  const byVote = byMotion && !isSoloMember(ledger, me);
  async function submit(date: WorkDate, name: string, off: boolean) {
    const cmd: Command = byMotion
      ? { type: 'ProposeMotion', motion: { kind: 'holiday', date, name, off } }
      : { type: 'SetHoliday', date, name, off };
    const d = await run(cmd);
    if (!d.ok) return false;
    if (byVote) feedback(d.value[0]?.id);
    else toast(t('calendar.saved'));
    return true;
  }
  return { submit, byVote };
}

function useVacationCommand() {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  return async (date: WorkDate, on: boolean) => {
    const d = await run({ type: 'SetVacation', date, on });
    if (d.ok) toast(t('calendar.saved'));
    return d.ok;
  };
}

const monthOf = (d: WorkDate) => d.slice(0, 7);
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', timeZone: 'UTC' });
const monthTitle = (month: string) => monthFmt.format(new Date(`${month}-01T00:00:00Z`));

function MonthView() {
  const t = useT();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const today = useLedger((s) => s.wallNow)().workDate;
  const [month, setMonth] = useState(monthOf(today));
  const [selected, setSelected] = useState<WorkDate>(today);
  const rs = currentRuleset(ledger);

  const first: WorkDate = `${month}-01`;
  const days: WorkDate[] = [];
  for (let d = first; monthOf(d) === month; d = addDays(d, 1)) days.push(d);
  const weekdays = t('calendar.weekdays').split(' ');

  function go(by: number) {
    const next = shiftMonth(month, by);
    setMonth(next);
    setSelected(next === monthOf(today) ? today : `${next}-01`);
  }

  return (
    <div className="cm-stack">
      <div className="cm-month-head">
        <button type="button" className="cm-icon-button" aria-label={t('calendar.prevMonth')} onClick={() => go(-1)}>
          ‹
        </button>
        <h3 className="cm-month-title" aria-live="polite">
          {monthTitle(month)}
        </h3>
        <button type="button" className="cm-icon-button" aria-label={t('calendar.nextMonth')} onClick={() => go(1)}>
          ›
        </button>
      </div>
      <div className="cm-month" role="group" aria-label={monthTitle(month)}>
        {weekdays.map((w, i) => (
          <span key={w} className={`cm-month-weekday${i === 0 ? ' is-off' : i === 6 ? ' is-sat' : ''}`} aria-hidden>
            {w}
          </span>
        ))}
        {days.map((d, i) => {
          const holiday = holidayOn(ledger, rs, d);
          const vacation = !!me && onVacation(ledger, me, d);
          const wd = weekday(d);
          const classes = ['cm-day', holiday || wd === 0 ? 'is-off' : wd === 6 ? 'is-sat' : '', d === today ? 'is-today' : '']
            .filter(Boolean)
            .join(' ');
          const label = [formatWorkDate(d), holiday, vacation && t('calendar.myVacation')].filter(Boolean).join(' · ');
          return (
            <button
              key={d}
              type="button"
              className={classes}
              // The first day sits under its weekday; the rest follow.
              style={i === 0 ? { gridColumnStart: wd + 1 } : undefined}
              aria-label={label}
              aria-pressed={d === selected}
              onClick={() => setSelected(d)}
            >
              <span className="cm-day-num">{Number(d.slice(8))}</span>
              {holiday && <span className="cm-day-note">{holiday}</span>}
              {vacation && <span className="cm-day-vacation" aria-hidden />}
            </button>
          );
        })}
      </div>
      <DayDetail date={selected} />
    </div>
  );
}

/** What the selected day is, with its holiday and vacation actions. */
function DayDetail({ date }: { date: WorkDate }) {
  const t = useT();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const now = useLedger((s) => s.nowIso)();
  const { submit, byVote } = useHolidayCommand();
  const setVacation = useVacationCommand();
  const [name, setName] = useState('');
  useEffect(() => setName(''), [date]);

  const holiday = holidayOn(ledger, currentRuleset(ledger), date);
  const vacation = !!me && onVacation(ledger, me, date);
  const pending = motionsOpen(ledger, now).some((m) => m.motion.kind === 'holiday' && m.motion.date === date);
  const kind = holiday ?? (isWeekend(date) ? t('calendar.weekend') : t('calendar.workday'));

  return (
    <section className="cm-section cm-inset" aria-labelledby="day-h">
      <h3 id="day-h">
        {formatWorkDate(date)} · {kind}
        {vacation && ` · ${t('calendar.myVacation')}`}
      </h3>
      {pending ? (
        <p className="cm-muted">{t('calendar.pending')}</p>
      ) : holiday ? (
        <button type="button" className="cm-button" onClick={() => void submit(date, holiday, false)}>
          {t('calendar.cancelHoliday')}
        </button>
      ) : (
        <form
          className="cm-row cm-row-fill"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await submit(date, name, true)) setName('');
          }}
        >
          <Field label={t('calendar.name')}>
            <input className="cm-input" required maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <button type="submit" className="cm-button" disabled={!name.trim()}>
            {t('calendar.setHoliday')}
          </button>
        </form>
      )}
      {byVote && !pending && <p className="cm-muted">{t('calendar.byVote')}</p>}
      {me && (
        <>
          <button type="button" className="cm-button" onClick={() => void setVacation(date, !vacation)}>
            {vacation ? t('calendar.removeVacation') : t('calendar.addVacation')}
          </button>
          {!vacation && <p className="cm-muted">{t('calendar.retroHint')}</p>}
        </>
      )}
    </section>
  );
}

function HolidayList() {
  const t = useT();
  const ledger = useLedger((s) => s.ledger);
  const today = useLedger((s) => s.wallNow)().workDate;
  const { submit } = useHolidayCommand();
  const rs = currentRuleset(ledger);

  const upcoming: { date: WorkDate; name: string }[] = [];
  for (let d = today; d <= addDays(today, UPCOMING_DAYS); d = addDays(d, 1)) {
    const holiday = holidayOn(ledger, rs, d);
    if (holiday) upcoming.push({ date: d, name: holiday });
  }

  return (
    <section className="cm-section" aria-labelledby="holidays-h">
      <h3 id="holidays-h">{t('calendar.upcoming')}</h3>
      <p className="cm-muted">
        {t('calendar.publicHolidays')}:{' '}
        {(rs.publicHolidays ?? 'KR') === 'KR' ? t('calendar.publicHolidays.on') : t('calendar.publicHolidays.off')}
      </p>
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
    </section>
  );
}

function VacationList() {
  const t = useT();
  const me = useLedger((s) => s.me);
  const dates = useLedger((s) => (s.me ? s.ledger.vacations[s.me] : undefined)) ?? [];
  const setVacation = useVacationCommand();
  if (!me) return null;
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
              <button type="button" className="cm-button cm-button-ghost" onClick={() => void setVacation(d, false)}>
                {t('calendar.removeVacation')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

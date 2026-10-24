import type { PlayerId } from './ids';
import type { Ruleset } from './ruleset';
import type { LedgerState } from './state';
import { weekday, type WorkDate } from './time';

/**
 * Statutory public holidays in Korea, including substitute holidays (대체공휴일). Needs a yearly update;
 * groups can add or cancel days of their own with HolidaySet.
 * Sources: 행정안전부·인사혁신처 announcements as compiled on 2026-10-24 (노동절 and 제헌절 are holidays from 2026).
 */
export const KR_PUBLIC_HOLIDAYS: Readonly<Record<WorkDate, string>> = {
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절',
  '2026-03-02': '대체공휴일(삼일절)',
  '2026-05-01': '노동절',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '대체공휴일(부처님오신날)',
  '2026-06-03': '전국동시지방선거',
  '2026-06-06': '현충일',
  '2026-07-17': '제헌절',
  '2026-08-15': '광복절',
  '2026-08-17': '대체공휴일(광복절)',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-05': '대체공휴일(개천절)',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴',
  '2027-02-07': '설날',
  '2027-02-08': '설날 연휴',
  '2027-02-09': '대체공휴일(설날)',
  '2027-03-01': '삼일절',
  '2027-05-01': '노동절',
  '2027-05-03': '대체공휴일(노동절)',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-07-17': '제헌절',
  '2027-07-19': '대체공휴일(제헌절)',
  '2027-08-15': '광복절',
  '2027-08-16': '대체공휴일(광복절)',
  '2027-09-14': '추석 연휴',
  '2027-09-15': '추석',
  '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절',
  '2027-10-04': '대체공휴일(개천절)',
  '2027-10-09': '한글날',
  '2027-10-11': '대체공휴일(한글날)',
  '2027-12-25': '성탄절',
  '2027-12-27': '대체공휴일(성탄절)',
};

export const isWeekend = (date: WorkDate): boolean => {
  const d = weekday(date);
  return d === 0 || d === 6;
};

/** The holiday name for `date` under the group's calendar, or undefined on a regular day. */
export function holidayOn(s: LedgerState, rs: Ruleset, date: WorkDate): string | undefined {
  const own = s.holidays[date];
  if (own) return own.off ? own.name : undefined;
  return (rs.publicHolidays ?? 'KR') === 'KR' ? KR_PUBLIC_HOLIDAYS[date] : undefined;
}

export const onVacation = (s: LedgerState, playerId: PlayerId, date: WorkDate): boolean =>
  s.vacations[playerId]?.includes(date) ?? false;

/** Whether `playerId` is expected to check in on `date`: a weekday that is neither a holiday nor their vacation. */
export const isWorkdayFor = (s: LedgerState, rs: Ruleset, playerId: PlayerId, date: WorkDate): boolean =>
  !isWeekend(date) && holidayOn(s, rs, date) === undefined && !onVacation(s, playerId, date);

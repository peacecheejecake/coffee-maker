import { wallTimeAt, type HHmm, type WorkDate } from '@coffee/core';

export interface WallTime {
  workDate: WorkDate;
  hhmm: HHmm;
}

/** The calendar date and HH:mm of an instant in the group's timezone (seconds truncated). */
export const wallTime = (at: Date, timeZone: string): WallTime => wallTimeAt(at, timeZone);

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
}

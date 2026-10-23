import type { Instant, WorkDate } from '@coffee/core';

const dayFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'UTC' });

/** "2026-10-23" → "10. 23. (금)" */
export const formatWorkDate = (d: WorkDate) => dayFmt.format(new Date(`${d}T12:00:00Z`));

const instantFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const formatInstant = (at: Instant, timeZone?: string) =>
  (timeZone
    ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
    : instantFmt
  ).format(new Date(at));

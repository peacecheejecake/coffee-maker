import type { Instant, WorkDate } from '@coffee/core';

const dayFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'UTC' });

/** "2026-10-23" → "10. 23. (금)" */
export const formatWorkDate = (d: WorkDate) => dayFmt.format(new Date(`${d}T12:00:00Z`));

/** 42 → "40m", 1234 → "1.2km". Positions are rough; more digits would only suggest otherwise. */
export const formatDistance = (meters: number) =>
  meters < 1000 ? `${Math.round(meters / 10) * 10}m` : `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)}km`;

const instantFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const formatInstant = (at: Instant, timeZone?: string) =>
  (timeZone
    ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
    : instantFmt
  ).format(new Date(at));

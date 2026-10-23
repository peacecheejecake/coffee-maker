/** Wall-clock time of day in the group's timezone, e.g. "09:05". */
export type HHmm = string;
/** Calendar date in the group's timezone, e.g. "2026-10-23". */
export type WorkDate = string;
/** Absolute instant, ISO-8601 (e.g. "2026-10-23T00:05:00.000Z"). */
export type Instant = string;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WORK_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export const isHHmm = (v: string): v is HHmm => HHMM.test(v);

export function toMinutes(v: HHmm): number {
  const m = HHMM.exec(v);
  if (!m) throw new RangeError(`Invalid HH:mm: ${v}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isWorkDate(v: string): v is WorkDate {
  if (!WORK_DATE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  // Rejects dates like 2026-02-30 that Date would silently roll over.
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(v);
}

export const daysBetween = (from: WorkDate, to: WorkDate): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

export const minutesBetween = (from: Instant, to: Instant): number =>
  (Date.parse(to) - Date.parse(from)) / MS_PER_MINUTE;

export const addHours = (at: Instant, hours: number): Instant =>
  new Date(Date.parse(at) + hours * 60 * MS_PER_MINUTE).toISOString();

export const isAfter = (a: Instant, b: Instant): boolean => Date.parse(a) > Date.parse(b);

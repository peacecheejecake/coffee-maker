import { daysBetween, type WorkDate } from './time';

export type CreditGrade = 'AAA' | 'A' | 'B' | 'C' | 'D';

/** Grade by number of outstanding cups. Titles live in the theme layer. */
export function creditGrade(outstanding: number): CreditGrade {
  if (outstanding <= 0) return 'AAA';
  if (outstanding <= 2) return 'A';
  if (outstanding <= 5) return 'B';
  if (outstanding <= 9) return 'C';
  return 'D';
}

export type CupAge = 'fresh' | 'cobweb' | 'ghost' | 'rip';

/** Visual aging of unpaid cups. Purely cosmetic; never affects the debt. */
export function cupAge(issuedOn: WorkDate, today: WorkDate): CupAge {
  const days = daysBetween(issuedOn, today);
  if (days >= 100) return 'rip';
  if (days >= 30) return 'ghost';
  if (days >= 7) return 'cobweb';
  return 'fresh';
}

import type { CupRule } from './ruleset';
import { toMinutes, type HHmm } from './time';

export interface Judgement {
  /** Minutes after the scheduled start (not after the grace period); 0 when early. */
  minutesLate: number;
  isLate: boolean;
}

export function judgeLateness(arrivedAt: HHmm, scheduledStart: HHmm, graceMinutes: number): Judgement {
  const minutesLate = Math.max(0, toMinutes(arrivedAt) - toMinutes(scheduledStart));
  return { minutesLate, isLate: minutesLate > graceMinutes };
}

export function computeCups(judgement: Judgement, rule: CupRule): number {
  if (!judgement.isLate) return 0;
  if (rule.mode === 'fixed') return rule.cups;
  const tier = rule.tiers.find((t) => t.upToMinutes === null || judgement.minutesLate <= t.upToMinutes);
  return tier?.cups ?? 0;
}

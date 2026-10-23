import { isHHmm, type HHmm } from './time';

export type CupRule =
  | { mode: 'fixed'; cups: number }
  /** Tiers sorted by `upToMinutes` ascending; the last tier has `upToMinutes: null` (no upper bound). */
  | { mode: 'tiered'; tiers: CupTier[] };

export interface CupTier {
  upToMinutes: number | null;
  cups: number;
}

export type WaivePolicy = { mode: 'unanimous'; ttlHours: number };

export interface Ruleset {
  defaultStartTime: HHmm;
  graceMinutes: number;
  cupRule: CupRule;
  requireReceipt: boolean;
  waivePolicy: WaivePolicy;
  /** IANA timezone used to derive work dates and wall-clock times. */
  timezone: string;
}

export const DEFAULT_RULESET: Ruleset = {
  defaultStartTime: '09:00',
  graceMinutes: 1,
  cupRule: { mode: 'fixed', cups: 1 },
  requireReceipt: true,
  waivePolicy: { mode: 'unanimous', ttlHours: 72 },
  timezone: 'Asia/Seoul',
};

export const RULESET_LIMITS = {
  graceMinutes: { min: 0, max: 30 },
  fixedCups: { min: 1, max: 5 },
  tierCups: { min: 1, max: 10 },
  waiveTtlHours: { min: 24, max: 168 },
} as const;

export interface RulesetIssue {
  path: string;
  message: string;
}

const inRange = (v: number, r: { min: number; max: number }) =>
  Number.isInteger(v) && v >= r.min && v <= r.max;

export function validateRuleset(rs: Ruleset): RulesetIssue[] {
  const issues: RulesetIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!isHHmm(rs.defaultStartTime)) add('defaultStartTime', 'must be HH:mm');
  if (!inRange(rs.graceMinutes, RULESET_LIMITS.graceMinutes)) add('graceMinutes', 'out of range');
  if (rs.timezone.trim() === '') add('timezone', 'required');
  if (!inRange(rs.waivePolicy.ttlHours, RULESET_LIMITS.waiveTtlHours)) add('waivePolicy.ttlHours', 'out of range');

  const rule = rs.cupRule;
  if (rule.mode === 'fixed') {
    if (!inRange(rule.cups, RULESET_LIMITS.fixedCups)) add('cupRule.cups', 'out of range');
  } else {
    if (rule.tiers.length === 0) add('cupRule.tiers', 'at least one tier required');
    rule.tiers.forEach((t, i) => {
      const isLast = i === rule.tiers.length - 1;
      if (!inRange(t.cups, RULESET_LIMITS.tierCups)) add(`cupRule.tiers.${i}.cups`, 'out of range');
      if (isLast) {
        if (t.upToMinutes !== null) add(`cupRule.tiers.${i}.upToMinutes`, 'last tier must be unbounded');
        return;
      }
      if (t.upToMinutes === null || !Number.isInteger(t.upToMinutes) || t.upToMinutes < 1) {
        add(`cupRule.tiers.${i}.upToMinutes`, 'must be a positive integer');
        return;
      }
      const prev = i > 0 ? rule.tiers[i - 1]?.upToMinutes : 0;
      if (typeof prev === 'number' && t.upToMinutes <= prev) {
        add(`cupRule.tiers.${i}.upToMinutes`, 'must be strictly ascending');
      }
    });
  }
  return issues;
}

import type { Vote } from './events';
import type { PlayerId } from './ids';
import type { MotionRecord, MotionStatus } from './state';
import { isAfter, type Instant } from './time';

/** Motions pass when every voter approves; one reject rejects. No voters means passed on proposal. */
export function tallyMotion(voters: readonly PlayerId[], votes: Partial<Record<PlayerId, Vote>>): 'pending' | 'approved' | 'rejected' {
  if (voters.some((v) => votes[v] === 'reject')) return 'rejected';
  return voters.every((v) => votes[v] === 'approve') ? 'approved' : 'pending';
}

/** Status as of `now` (expiry needs a clock, so the projection leaves it open). */
export const motionStatus = (m: MotionRecord, now: Instant): MotionStatus =>
  m.status === 'open' && isAfter(now, m.expiresAt) ? 'expired' : m.status;

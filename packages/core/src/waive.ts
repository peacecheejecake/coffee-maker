import type { Vote } from './events';
import type { PlayerId } from './ids';
import type { WaivePolicy } from './ruleset';
import type { ProposalStatus, WaiveProposal } from './state';
import { isAfter, type Instant } from './time';

export type Tally = 'pending' | 'approved' | 'rejected';

export function tallyWaive(
  policy: WaivePolicy,
  voters: readonly PlayerId[],
  votes: Partial<Record<PlayerId, Vote>>,
): Tally {
  switch (policy.mode) {
    case 'unanimous':
      if (voters.some((v) => votes[v] === 'reject')) return 'rejected';
      return voters.every((v) => votes[v] === 'approve') ? 'approved' : 'pending';
  }
}

/** Status as of `now`. The projection cannot know about expiry without a clock, so it is resolved here. */
export function proposalStatus(p: WaiveProposal, now: Instant): ProposalStatus {
  return p.status === 'open' && isAfter(now, p.expiresAt) ? 'expired' : p.status;
}

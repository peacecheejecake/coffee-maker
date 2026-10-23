import type { LateChanges, RedeemOrder, StampQuality, Vote } from './events';
import type { EventId, PlayerId } from './ids';
import type { Player } from './player';
import type { Ruleset, WaivePolicy } from './ruleset';
import type { HHmm, Instant, WorkDate } from './time';

export interface Cup {
  /** `${sourceId}#${n}` — deterministic, identical on every device. */
  id: string;
  sourceId: EventId;
  issuedOn: WorkDate;
}

export interface ReceivedCoffee {
  cupId: string;
  from: PlayerId;
  redemptionId: EventId;
}

export interface Tower {
  playerId: PlayerId;
  /** Bottom (oldest) → top (newest). */
  cups: Cup[];
  received: ReceivedCoffee[];
}

export interface CorrectionEntry {
  eventId: EventId;
  actorId: PlayerId;
  at: Instant;
  changes: LateChanges;
  reason?: string;
  before: { scheduledStart: HHmm; arrivedAt: HHmm; minutesLate: number; cups: number; note?: string };
}

export type LateStatus = 'active' | 'retracted' | 'waived';

export interface LateRecord {
  id: EventId;
  playerId: PlayerId;
  workDate: WorkDate;
  scheduledStart: HHmm;
  arrivedAt: HHmm;
  minutesLate: number;
  /** Cups currently claimed by this record (after corrections). */
  cups: number;
  cupsOverridden: boolean;
  note?: string;
  recordedBy: PlayerId;
  recordedAt: Instant;
  status: LateStatus;
  /** Number of cup ids handed out so far; next cup is `#${issued + 1}`. */
  issued: number;
  /** Cups of this record removed by redemptions. */
  redeemed: number;
  corrections: CorrectionEntry[];
  openProposalId?: EventId;
}

export type ProposalStatus = 'open' | 'approved' | 'rejected' | 'withdrawn' | 'expired' | 'void';

export interface WaiveProposal {
  id: EventId;
  targetId: EventId;
  debtorId: PlayerId;
  proposerId: PlayerId;
  reason: string;
  voters: PlayerId[];
  policy: WaivePolicy;
  proposedAt: Instant;
  expiresAt: Instant;
  votes: Partial<Record<PlayerId, Vote>>;
  status: ProposalStatus;
  closedAt?: Instant;
}

export interface Redemption {
  id: EventId;
  debtorId: PlayerId;
  payerId: PlayerId;
  recordedBy: PlayerId;
  at: Instant;
  requested: number;
  /** Cups actually removed (may be fewer than requested after concurrent edits). */
  cupIds: string[];
  recipients: PlayerId[];
  order: RedeemOrder;
  stampQuality: StampQuality;
  evidence?: { assetId: string };
  acknowledgedBy: PlayerId[];
}

export interface RulesetEntry {
  effectiveFrom: WorkDate;
  ruleset: Ruleset;
}

export interface LedgerState {
  players: Partial<Record<PlayerId, Player>>;
  playerOrder: PlayerId[];
  /** Sorted by effectiveFrom ascending. */
  rulesets: RulesetEntry[];
  lates: Partial<Record<EventId, LateRecord>>;
  lateOrder: EventId[];
  towers: Partial<Record<PlayerId, Tower>>;
  redemptions: Partial<Record<EventId, Redemption>>;
  redemptionOrder: EventId[];
  proposals: Partial<Record<EventId, WaiveProposal>>;
  proposalOrder: EventId[];
  /** Redeemed cups that found nothing to remove (concurrent redemptions). */
  unappliedRedeemed: Partial<Record<PlayerId, number>>;
}

export const emptyState = (): LedgerState => ({
  players: {},
  playerOrder: [],
  rulesets: [],
  lates: {},
  lateOrder: [],
  towers: {},
  redemptions: {},
  redemptionOrder: [],
  proposals: {},
  proposalOrder: [],
  unappliedRedeemed: {},
});

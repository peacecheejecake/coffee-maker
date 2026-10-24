import type { GroupMode, LateChanges, Motion, RedeemOrder, StampQuality, Vote } from './events';
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

/** `excused`: an attendance record closed because the day became a holiday or vacation afterwards. */
export type LateStatus = 'active' | 'retracted' | 'waived' | 'excused';

/**
 * Where a record came from. Absent: recorded by someone in the shared ledger. `checkIn`: the player's own late
 * check-in. `missed`: no check-in on a work day. `adjustment`: cups added by an approved motion (no times).
 */
export type LateOrigin = 'checkIn' | 'missed' | 'adjustment';

export interface LateRecord {
  id: EventId;
  playerId: PlayerId;
  workDate: WorkDate;
  /** Empty for adjustments. */
  scheduledStart: HHmm;
  /** Empty for adjustments and missed days. */
  arrivedAt: HHmm;
  minutesLate: number;
  origin?: LateOrigin;
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
  reverted: boolean;
  /** Paid through an approved redeem motion: the decision belongs to the voters and is not undoable. */
  viaMotion?: true;
}

export type MotionStatus = ProposalStatus;

export interface MotionRecord {
  id: EventId;
  motion: Motion;
  proposerId: PlayerId;
  voters: PlayerId[];
  proposedAt: Instant;
  expiresAt: Instant;
  votes: Partial<Record<PlayerId, Vote>>;
  status: MotionStatus;
  closedAt?: Instant;
}

export interface Holiday {
  name: string;
  /** false cancels a built-in public holiday for this group. */
  off: boolean;
}

export interface AttendanceState {
  /** Set by RulesAdopted; cleared when the mode changes. */
  adoptedOn?: WorkDate;
  /** First work date that is judged: the day after adoption. */
  startsOn?: WorkDate;
  /** `${playerId}|${workDate}` → how the day was settled. */
  days: Partial<Record<string, 'checkIn' | 'missed'>>;
}

export interface RulesetEntry {
  effectiveFrom: WorkDate;
  ruleset: Ruleset;
}

export interface OnTimeRecord {
  id: EventId;
  playerId: PlayerId;
  workDate: WorkDate;
  arrivedAt: HHmm;
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
  onTimes: OnTimeRecord[];
  mode: GroupMode;
  attendance: AttendanceState;
  /** Date each player joined (group timezone), from the join event's time; reset when un-archived. */
  joinedOn: Partial<Record<PlayerId, WorkDate>>;
  /**
   * Players who have acted themselves at least once (joined by invite, claimed, or any own event). Players
   * someone else added and nobody uses cannot check in, so attendance and motions leave them out.
   */
  acted: Partial<Record<PlayerId, Instant>>;
  holidays: Partial<Record<WorkDate, Holiday>>;
  /** Sorted vacation dates per player. */
  vacations: Partial<Record<PlayerId, WorkDate[]>>;
  motions: Partial<Record<EventId, MotionRecord>>;
  motionOrder: EventId[];
}

export const attendanceKey = (playerId: PlayerId, date: WorkDate) => `${playerId}|${date}`;

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
  onTimes: [],
  mode: 'shared',
  attendance: { days: {} },
  joinedOn: {},
  acted: {},
  holidays: {},
  vacations: {},
  motions: {},
  motionOrder: [],
});

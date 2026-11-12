import type { EventId, GroupId, PlayerId } from './ids';
import type { Player, PlayerPatch } from './player';
import type { Ruleset, WaivePolicy } from './ruleset';
import type { HHmm, Instant, WorkDate } from './time';

export const CURRENT_SCHEMA_VERSION = 1;

export interface EventMeta {
  id: EventId;
  groupId: GroupId;
  /** Player who caused the event. */
  actorId: PlayerId;
  /** Client clock when the event was created. */
  at: Instant;
  schemaVersion: number;
  /** Server clock at insert. Authoritative for time windows once synced. */
  serverAt?: Instant;
  /** Server-assigned canonical order. */
  seq?: number;
}

export type StampQuality = 'clean' | 'faint' | 'smudged';
export type RedeemOrder = 'newest' | 'oldest';
export type Vote = 'approve' | 'reject';

/** `shared`: anyone records anyone's lateness. `attendance` (자진 출두): everyone checks themselves in. */
export type GroupMode = 'shared' | 'attendance';

/** What a motion changes once every voter approves (ADR 0002). */
export type Motion =
  | { kind: 'ruleset'; ruleset: Ruleset }
  | { kind: 'holiday'; date: WorkDate; name: string; off: boolean }
  /** Adds (delta > 0) or removes (delta < 0) cups regardless of any date. */
  | { kind: 'adjust'; playerId: PlayerId; delta: number; reason: string }
  /** One cup paid back by the debtor. */
  | { kind: 'redeem'; debtorId: PlayerId; recipients: PlayerId[]; stampQuality: StampQuality; evidence?: { assetId: string } }
  /**
   * Moves `playerIds` between participant and spectator (ADR 0004). A spectator keeps their tower and still
   * sees everything, but is not judged, charged or asked to vote. `forgive` also wipes the cups they still
   * owe when turning them into spectators.
   */
  | { kind: 'spectate'; playerIds: PlayerId[]; spectator: boolean; forgive?: boolean };

export type MotionKind = Motion['kind'];

export interface LateChanges {
  scheduledStart?: HHmm;
  arrivedAt?: HHmm;
  cups?: number;
  note?: string;
}

export type EventPayload =
  | { type: 'PlayerJoined'; player: Player }
  | { type: 'PlayerUpdated'; playerId: PlayerId; patch: PlayerPatch }
  | { type: 'RulesetChanged'; ruleset: Ruleset; effectiveFrom: WorkDate }
  | {
      type: 'LateRecorded';
      playerId: PlayerId;
      workDate: WorkDate;
      scheduledStart: HHmm;
      arrivedAt: HHmm;
      /** Stored rather than recomputed so history replays identically under later rulesets. */
      minutesLate: number;
      cups: number;
      cupsOverridden: boolean;
      note?: string;
    }
  | {
      type: 'LateCorrected';
      targetId: EventId;
      changes: LateChanges;
      resultingMinutesLate: number;
      resultingCups: number;
      reason?: string;
    }
  | { type: 'LateRetracted'; targetId: EventId }
  /** Recorded so other devices can celebrate and streaks can be counted; carries no debt. */
  | { type: 'ArrivalOnTime'; playerId: PlayerId; workDate: WorkDate; arrivedAt: HHmm; minutesLate: number }
  | {
      type: 'WaiveProposed';
      targetId: EventId;
      reason: string;
      /** Snapshot at proposal time; later joiners never get a vote. */
      voters: PlayerId[];
      policy: WaivePolicy;
      expiresAt: Instant;
    }
  | { type: 'WaiveVoted'; proposalId: EventId; vote: Vote }
  | { type: 'WaiveWithdrawn'; proposalId: EventId }
  | {
      type: 'CupsRedeemed';
      debtorId: PlayerId;
      payerId: PlayerId;
      count: number;
      recipients: PlayerId[];
      order: RedeemOrder;
      stampQuality: StampQuality;
      evidence?: { assetId: string };
    }
  | { type: 'RedemptionAcknowledged'; redemptionId: EventId }
  /** Undo of a redemption by whoever recorded it, within the retract window. */
  | { type: 'RedemptionReverted'; redemptionId: EventId }
  /** The account behind this device now acts as the actor (after claiming a player someone else added). */
  | { type: 'PlayerClaimed' }
  | { type: 'ModeChanged'; mode: GroupMode }
  | { type: 'OwnerTransferred'; to: PlayerId }
  /** The explicit first confirmation of the common rules in attendance mode. */
  | { type: 'RulesAdopted'; ruleset: Ruleset }
  /** The actor checks in for `workDate`; the arrival time is the event's own (server) time. */
  | { type: 'CheckedIn'; workDate: WorkDate }
  /** Issued by any member's device once `workDate` is over; id is `missedEventId(...)`. */
  | { type: 'AttendanceMissed'; playerId: PlayerId; workDate: WorkDate }
  | { type: 'HolidaySet'; date: WorkDate; name: string; off: boolean }
  /** The actor's own vacation; may be registered after the fact. */
  | { type: 'VacationSet'; date: WorkDate; on: boolean }
  | { type: 'MotionProposed'; motion: Motion; voters: PlayerId[]; expiresAt: Instant }
  | { type: 'MotionVoted'; motionId: EventId; vote: Vote }
  | { type: 'MotionWithdrawn'; motionId: EventId };

export type LedgerEvent = EventMeta & EventPayload;
export type EventType = LedgerEvent['type'];
export type EventOf<T extends EventType> = Extract<LedgerEvent, { type: T }>;

/** Deterministic id so every device that settles the same missed day produces the same event. */
export const missedEventId = (groupId: GroupId, playerId: PlayerId, workDate: WorkDate): EventId =>
  `miss:${groupId}:${playerId}:${workDate}` as EventId;

/** The instant used for time-window rules: server time once known, client time before that. */
export const effectiveAt = (e: EventMeta): Instant => e.serverAt ?? e.at;

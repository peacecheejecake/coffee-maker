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
  | { type: 'RedemptionReverted'; redemptionId: EventId };

export type LedgerEvent = EventMeta & EventPayload;
export type EventType = LedgerEvent['type'];
export type EventOf<T extends EventType> = Extract<LedgerEvent, { type: T }>;

/** The instant used for time-window rules: server time once known, client time before that. */
export const effectiveAt = (e: EventMeta): Instant => e.serverAt ?? e.at;

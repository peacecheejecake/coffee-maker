import { domainError, type DomainError } from './errors';
import {
  CURRENT_SCHEMA_VERSION,
  type EventPayload,
  type LateChanges,
  type LedgerEvent,
  type RedeemOrder,
  type StampQuality,
  type Vote,
} from './events';
import { asEventId, asPlayerId, type EventId, type GroupId, type PlayerId } from './ids';
import { computeCups, judgeLateness } from './judge';
import type { Player, PlayerAppearance, PlayerPatch, PlayerRole } from './player';
import { RETRACT_WINDOW_MINUTES } from './policy';
import { err, ok, type Result } from './result';
import { validateRuleset, type Ruleset } from './ruleset';
import {
  activePlayers,
  currentRuleset,
  openProposal,
  outstanding,
  previewArrival,
  rulesetAt,
} from './selectors';
import type { LedgerState } from './state';
import { addHours, isHHmm, isWorkDate, minutesBetween, type HHmm, type Instant, type WorkDate } from './time';
import { proposalStatus } from './waive';

export const MAX_CUPS_PER_RECORD = 10;

export type Command =
  | {
      type: 'AddPlayer';
      /** Lets the first player on a device pick their own id before any event exists. */
      id?: PlayerId;
      name: string;
      appearance: PlayerAppearance;
      startTimeOverride?: HHmm;
      role?: PlayerRole;
    }
  | { type: 'UpdatePlayer'; playerId: PlayerId; patch: PlayerPatch }
  | { type: 'ChangeRuleset'; ruleset: Ruleset }
  | {
      type: 'RecordArrival';
      playerId: PlayerId;
      /** Defaults to today. */
      workDate?: WorkDate;
      arrivedAt: HHmm;
      /** Defaults to the player's override, then the ruleset's start time. */
      scheduledStart?: HHmm;
      cupsOverride?: number;
      note?: string;
      /** Record even though an active record already exists for that date. */
      allowDuplicate?: boolean;
    }
  | { type: 'CorrectLate'; targetId: EventId; changes: LateChanges; reason?: string }
  | { type: 'RetractLate'; targetId: EventId }
  | { type: 'ProposeWaive'; targetId: EventId; reason: string }
  | { type: 'VoteWaive'; proposalId: EventId; vote: Vote }
  | { type: 'WithdrawWaive'; proposalId: EventId }
  | {
      type: 'Redeem';
      debtorId: PlayerId;
      /** Defaults to the actor. Differs from the debtor when someone pays on their behalf. */
      payerId?: PlayerId;
      count: number;
      recipients: PlayerId[];
      order?: RedeemOrder;
      stampQuality: StampQuality;
      evidence?: { assetId: string };
    }
  | { type: 'AcknowledgeRedemption'; redemptionId: EventId };

export interface DecideContext {
  groupId: GroupId;
  actorId: PlayerId;
  now: Instant;
  /** Today's date in the group's timezone (resolved by the app layer). */
  today: WorkDate;
  newId: () => string;
}

export type Decision = Result<LedgerEvent[], DomainError>;

/** Validates a command against the current state and turns it into events. Pure. */
export function decide(state: LedgerState, cmd: Command, ctx: DecideContext): Decision {
  const make = (payload: EventPayload): LedgerEvent => ({
    id: asEventId(ctx.newId()),
    groupId: ctx.groupId,
    actorId: ctx.actorId,
    at: ctx.now,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...payload,
  });

  if (cmd.type === 'AddPlayer') return addPlayer(state, cmd, ctx, make);

  const actor = state.players[ctx.actorId];
  if (!actor || actor.archived) return fail('NotPermitted', 'Actor is not an active member');

  switch (cmd.type) {
    case 'UpdatePlayer':
      return updatePlayer(state, cmd, actor, make);
    case 'ChangeRuleset':
      return changeRuleset(cmd, actor, ctx, make);
    case 'RecordArrival':
      return recordArrival(state, cmd, ctx, make);
    case 'CorrectLate':
      return correctLate(state, cmd, make);
    case 'RetractLate':
      return retractLate(state, cmd, ctx, make);
    case 'ProposeWaive':
      return proposeWaive(state, cmd, ctx, make);
    case 'VoteWaive':
      return voteWaive(state, cmd, ctx, make);
    case 'WithdrawWaive':
      return withdrawWaive(state, cmd, ctx, make);
    case 'Redeem':
      return redeem(state, cmd, ctx, make);
    case 'AcknowledgeRedemption':
      return acknowledge(state, cmd, ctx, make);
  }
}

type Make = (payload: EventPayload) => LedgerEvent;
type Cmd<T extends Command['type']> = Extract<Command, { type: T }>;

const fail = (...args: Parameters<typeof domainError>): Decision => err(domainError(...args));
const emit = (...events: LedgerEvent[]): Decision => ok(events);
const isCupCount = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_CUPS_PER_RECORD;

// ── players & rules ─────────────────────────────────────────────────────────

function addPlayer(s: LedgerState, cmd: Cmd<'AddPlayer'>, ctx: DecideContext, make: Make): Decision {
  const bootstrapping = s.playerOrder.length === 0;
  const actor = s.players[ctx.actorId];
  if (!bootstrapping && (!actor || actor.archived)) return fail('NotPermitted', 'Actor is not an active member');
  if (!bootstrapping && cmd.role === 'owner' && actor?.role !== 'owner') {
    return fail('NotPermitted', 'Only an owner can add another owner');
  }
  const name = cmd.name.trim();
  if (name === '') return fail('InvalidInput', 'Name is required');
  if (cmd.startTimeOverride !== undefined && !isHHmm(cmd.startTimeOverride)) {
    return fail('InvalidInput', 'startTimeOverride must be HH:mm');
  }
  const id = cmd.id ?? asPlayerId(ctx.newId());
  if (s.players[id]) return fail('InvalidInput', 'Player id already exists');

  const player: Player = {
    id,
    name,
    role: bootstrapping ? 'owner' : (cmd.role ?? 'member'),
    appearance: cmd.appearance,
    ...(cmd.startTimeOverride !== undefined && { startTimeOverride: cmd.startTimeOverride }),
    archived: false,
  };
  return emit(make({ type: 'PlayerJoined', player }));
}

function updatePlayer(s: LedgerState, cmd: Cmd<'UpdatePlayer'>, actor: Player, make: Make): Decision {
  const target = s.players[cmd.playerId];
  if (!target) return fail('PlayerNotFound', 'No such player');
  const isOwner = actor.role === 'owner';
  if (cmd.patch.archived !== undefined && !isOwner) return fail('NotPermitted', 'Only an owner can archive players');
  if (target.id !== actor.id && !isOwner) return fail('NotPermitted', 'Members can only edit themselves');
  if (cmd.patch.name !== undefined && cmd.patch.name.trim() === '') return fail('InvalidInput', 'Name is required');
  if (cmd.patch.startTimeOverride !== undefined && !isHHmm(cmd.patch.startTimeOverride)) {
    return fail('InvalidInput', 'startTimeOverride must be HH:mm');
  }
  const patch = cmd.patch.name !== undefined ? { ...cmd.patch, name: cmd.patch.name.trim() } : cmd.patch;
  return emit(make({ type: 'PlayerUpdated', playerId: target.id, patch }));
}

function changeRuleset(cmd: Cmd<'ChangeRuleset'>, actor: Player, ctx: DecideContext, make: Make): Decision {
  if (actor.role !== 'owner') return fail('NotPermitted', 'Only an owner can change the ruleset');
  const issues = validateRuleset(cmd.ruleset);
  if (issues.length > 0) return fail('InvalidRuleset', 'Ruleset is invalid', { issues });
  // Not retroactive: applies to records whose work date is today or later.
  return emit(make({ type: 'RulesetChanged', ruleset: cmd.ruleset, effectiveFrom: ctx.today }));
}

// ── late records ────────────────────────────────────────────────────────────

function recordArrival(s: LedgerState, cmd: Cmd<'RecordArrival'>, ctx: DecideContext, make: Make): Decision {
  const player = s.players[cmd.playerId];
  if (!player || player.archived) return fail('PlayerNotFound', 'No such active player');
  const workDate = cmd.workDate ?? ctx.today;
  if (!isWorkDate(workDate)) return fail('InvalidInput', 'workDate must be YYYY-MM-DD');
  if (!isHHmm(cmd.arrivedAt)) return fail('InvalidInput', 'arrivedAt must be HH:mm');
  if (cmd.scheduledStart !== undefined && !isHHmm(cmd.scheduledStart)) {
    return fail('InvalidInput', 'scheduledStart must be HH:mm');
  }
  if (cmd.cupsOverride !== undefined && !isCupCount(cmd.cupsOverride)) {
    return fail('InvalidInput', `cupsOverride must be 1–${MAX_CUPS_PER_RECORD}`);
  }

  const preview = previewArrival(s, {
    playerId: player.id,
    workDate,
    arrivedAt: cmd.arrivedAt,
    ...(cmd.scheduledStart !== undefined && { scheduledStart: cmd.scheduledStart }),
  });
  if (preview.duplicateOf && !cmd.allowDuplicate) {
    return fail('DuplicateWorkDate', 'A late record already exists for this date', { existingId: preview.duplicateOf });
  }

  const cups = cmd.cupsOverride ?? preview.cups;
  if (cups === 0) return emit(); // on time: nothing to record

  const note = cmd.note?.trim();
  return emit(
    make({
      type: 'LateRecorded',
      playerId: player.id,
      workDate,
      scheduledStart: preview.scheduledStart,
      arrivedAt: cmd.arrivedAt,
      minutesLate: preview.minutesLate,
      cups,
      cupsOverridden: cmd.cupsOverride !== undefined,
      ...(note && { note }),
    }),
  );
}

function correctLate(s: LedgerState, cmd: Cmd<'CorrectLate'>, make: Make): Decision {
  const rec = s.lates[cmd.targetId];
  if (!rec) return fail('TargetNotFound', 'No such late record');
  if (rec.status !== 'active') return fail('AlreadyClosed', `Record is ${rec.status}`);
  const { changes } = cmd;
  if (changes.arrivedAt !== undefined && !isHHmm(changes.arrivedAt)) return fail('InvalidInput', 'arrivedAt must be HH:mm');
  if (changes.scheduledStart !== undefined && !isHHmm(changes.scheduledStart)) {
    return fail('InvalidInput', 'scheduledStart must be HH:mm');
  }
  if (changes.cups !== undefined && changes.cups !== 0 && !isCupCount(changes.cups)) {
    return fail('InvalidInput', `cups must be 1–${MAX_CUPS_PER_RECORD}`);
  }

  // Keep only fields that actually change.
  const effective: LateChanges = {};
  if (changes.scheduledStart !== undefined && changes.scheduledStart !== rec.scheduledStart) {
    effective.scheduledStart = changes.scheduledStart;
  }
  if (changes.arrivedAt !== undefined && changes.arrivedAt !== rec.arrivedAt) effective.arrivedAt = changes.arrivedAt;
  if (changes.cups !== undefined && changes.cups !== rec.cups) effective.cups = changes.cups;
  const note = changes.note?.trim();
  if (note !== undefined && note !== (rec.note ?? '')) effective.note = note;
  if (Object.keys(effective).length === 0) return fail('NoChange', 'Nothing to correct');

  // Recompute with the rules that applied on the record's own date (corrections are not retroactive either).
  const rs = rulesetAt(s, rec.workDate);
  const judgement = judgeLateness(
    effective.arrivedAt ?? rec.arrivedAt,
    effective.scheduledStart ?? rec.scheduledStart,
    rs.graceMinutes,
  );
  const timeChanged = effective.arrivedAt !== undefined || effective.scheduledStart !== undefined;
  const resultingCups =
    effective.cups ?? (timeChanged && !rec.cupsOverridden ? computeCups(judgement, rs.cupRule) : rec.cups);

  if (resultingCups < 1) {
    // Bringing a record to zero is a waiver in disguise; that needs a vote.
    return fail('CorrectionToZero', 'Removing all cups requires a waive vote', {
      minutesLate: judgement.minutesLate,
    });
  }

  const reason = cmd.reason?.trim();
  return emit(
    make({
      type: 'LateCorrected',
      targetId: rec.id,
      changes: effective,
      resultingMinutesLate: judgement.minutesLate,
      resultingCups,
      ...(reason && { reason }),
    }),
  );
}

function retractLate(s: LedgerState, cmd: Cmd<'RetractLate'>, ctx: DecideContext, make: Make): Decision {
  const rec = s.lates[cmd.targetId];
  if (!rec) return fail('TargetNotFound', 'No such late record');
  if (rec.status !== 'active') return fail('AlreadyClosed', `Record is ${rec.status}`);
  if (rec.recordedBy !== ctx.actorId) return fail('NotPermitted', 'Only the recorder can retract');
  if (minutesBetween(rec.recordedAt, ctx.now) > RETRACT_WINDOW_MINUTES) {
    return fail('RetractWindowClosed', `Retraction is only possible within ${RETRACT_WINDOW_MINUTES} minutes`);
  }
  return emit(make({ type: 'LateRetracted', targetId: rec.id }));
}

// ── waive proposals ─────────────────────────────────────────────────────────

function proposeWaive(s: LedgerState, cmd: Cmd<'ProposeWaive'>, ctx: DecideContext, make: Make): Decision {
  const reason = cmd.reason.trim();
  if (reason === '') return fail('ReasonRequired', 'A reason is required');
  const rec = s.lates[cmd.targetId];
  if (!rec) return fail('TargetNotFound', 'No such late record');
  if (rec.status !== 'active') return fail('AlreadyClosed', `Record is ${rec.status}`);
  const open = openProposal(s, rec.id, ctx.now);
  if (open) return fail('ProposalAlreadyOpen', 'This record is already under review', { proposalId: open.id });

  const voters = activePlayers(s)
    .map((p) => p.id)
    .filter((id) => id !== rec.playerId);
  if (voters.length === 0) return fail('NoEligibleVoters', 'Nobody besides the debtor can vote');

  const policy = currentRuleset(s).waivePolicy;
  const proposed = make({
    type: 'WaiveProposed',
    targetId: rec.id,
    reason,
    voters,
    policy,
    expiresAt: addHours(ctx.now, policy.ttlHours),
  });
  // A proposer who is not the debtor obviously supports the waiver.
  if (!voters.includes(ctx.actorId)) return emit(proposed);
  return emit(proposed, make({ type: 'WaiveVoted', proposalId: proposed.id, vote: 'approve' }));
}

function voteWaive(s: LedgerState, cmd: Cmd<'VoteWaive'>, ctx: DecideContext, make: Make): Decision {
  const p = s.proposals[cmd.proposalId];
  if (!p) return fail('TargetNotFound', 'No such proposal');
  const status = proposalStatus(p, ctx.now);
  if (status !== 'open') return fail('ProposalClosed', `Proposal is ${status}`);
  if (!p.voters.includes(ctx.actorId)) return fail('NotAVoter', 'You have no vote on this proposal');
  if (p.votes[ctx.actorId] !== undefined) return fail('AlreadyVoted', 'Votes cannot be changed');
  return emit(make({ type: 'WaiveVoted', proposalId: p.id, vote: cmd.vote }));
}

function withdrawWaive(s: LedgerState, cmd: Cmd<'WithdrawWaive'>, ctx: DecideContext, make: Make): Decision {
  const p = s.proposals[cmd.proposalId];
  if (!p) return fail('TargetNotFound', 'No such proposal');
  const status = proposalStatus(p, ctx.now);
  if (status !== 'open') return fail('ProposalClosed', `Proposal is ${status}`);
  if (p.proposerId !== ctx.actorId) return fail('NotPermitted', 'Only the proposer can withdraw');
  return emit(make({ type: 'WaiveWithdrawn', proposalId: p.id }));
}

// ── redemptions ─────────────────────────────────────────────────────────────

function redeem(s: LedgerState, cmd: Cmd<'Redeem'>, ctx: DecideContext, make: Make): Decision {
  if (!s.players[cmd.debtorId]) return fail('PlayerNotFound', 'No such debtor');
  const payerId = cmd.payerId ?? ctx.actorId;
  if (!s.players[payerId]) return fail('PlayerNotFound', 'No such payer');
  if (!Number.isInteger(cmd.count) || cmd.count < 1) return fail('InvalidInput', 'count must be a positive integer');
  const recipients = [...new Set(cmd.recipients)];
  if (recipients.length === 0) return fail('InvalidInput', 'At least one recipient is required');
  if (recipients.some((r) => !s.players[r])) return fail('PlayerNotFound', 'Unknown recipient');

  const owed = outstanding(s, cmd.debtorId);
  if (owed === 0) return fail('NothingToRedeem', 'No outstanding cups');
  if (cmd.count > owed) return fail('RedeemExceedsDebt', `Only ${owed} cups outstanding`, { outstanding: owed });

  return emit(
    make({
      type: 'CupsRedeemed',
      debtorId: cmd.debtorId,
      payerId,
      count: cmd.count,
      recipients,
      order: cmd.order ?? 'newest',
      stampQuality: cmd.stampQuality,
      ...(cmd.evidence && { evidence: cmd.evidence }),
    }),
  );
}

function acknowledge(s: LedgerState, cmd: Cmd<'AcknowledgeRedemption'>, ctx: DecideContext, make: Make): Decision {
  const r = s.redemptions[cmd.redemptionId];
  if (!r) return fail('TargetNotFound', 'No such redemption');
  if (!r.recipients.includes(ctx.actorId)) return fail('NotPermitted', 'Only a recipient can acknowledge');
  if (r.acknowledgedBy.includes(ctx.actorId)) return fail('NoChange', 'Already acknowledged');
  return emit(make({ type: 'RedemptionAcknowledged', redemptionId: r.id }));
}

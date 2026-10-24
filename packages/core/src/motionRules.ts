import type { Motion, StampQuality } from './events';
import type { PlayerId } from './ids';
import { MAX_CUPS_PER_RECORD } from './policy';
import { isValidRuleset } from './ruleset';
import { activePlayers, currentRuleset } from './selectors';
import type { LedgerState } from './state';
import { isWorkDate } from './time';

/**
 * Rules shared by `decide` (to explain refusals) and `evolve` (to ignore forged events): who votes on a motion
 * and what a well-formed motion looks like. The server only checks ballots against the event's own voter list,
 * so `evolve` must re-derive that list itself.
 */

/** Players who take part in motions: active and using the app themselves. */
export const motionMembers = (s: LedgerState): PlayerId[] =>
  activePlayers(s)
    .filter((p) => s.acted[p.id])
    .map((p) => p.id);

/** Nobody else takes part, so every motion of `me` passes on the spot (the UI then skips the voting wording). */
export const isSoloMember = (s: LedgerState, me: PlayerId | null | undefined): boolean =>
  !!me && motionMembers(s).every((id) => id === me);

/**
 * Voters by kind (ADR 0002): someone else's cup n−2, one's own n−1, adjustments all but the player.
 * `includeInactive` applies only the per-kind exclusions to every known player (for checking stale lists).
 */
export function motionVoters(
  s: LedgerState,
  proposerId: PlayerId,
  motion: Motion,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): PlayerId[] {
  const members = includeInactive ? s.playerOrder : motionMembers(s);
  switch (motion.kind) {
    case 'ruleset':
    case 'holiday':
      return members;
    case 'adjust':
      return members.filter((id) => id !== motion.playerId);
    case 'redeem':
      return members.filter((id) => id !== proposerId && id !== motion.debtorId);
  }
}

const STAMPS: readonly StampQuality[] = ['clean', 'faint', 'smudged'];

/** What is wrong with a motion's payload, or undefined. Never throws on malformed input. */
export function motionIssue(s: LedgerState, motion: Motion): string | undefined {
  const active = (id: unknown) => {
    const p = typeof id === 'string' ? s.players[id as PlayerId] : undefined;
    return !!p && !p.archived;
  };
  switch (motion?.kind) {
    case 'ruleset':
      if (!isValidRuleset(motion.ruleset)) return 'invalid ruleset';
      // The server judges days in the group's timezone; it only changes before rules are adopted.
      if (motion.ruleset.timezone !== currentRuleset(s).timezone) return 'timezone cannot change by motion';
      return undefined;
    case 'holiday':
      if (typeof motion.date !== 'string' || !isWorkDate(motion.date)) return 'date must be YYYY-MM-DD';
      if (typeof motion.off !== 'boolean' || typeof motion.name !== 'string') return 'invalid holiday';
      if (motion.off && motion.name.trim() === '') return 'a holiday needs a name';
      return undefined;
    case 'adjust':
      if (!active(motion.playerId)) return 'no such active player';
      if (!Number.isInteger(motion.delta) || motion.delta === 0 || Math.abs(motion.delta) > MAX_CUPS_PER_RECORD) {
        return `delta must be ±1–${MAX_CUPS_PER_RECORD}`;
      }
      if (typeof motion.reason !== 'string' || motion.reason.trim() === '') return 'reason required';
      return undefined;
    case 'redeem':
      if (!s.players[motion.debtorId]) return 'no such debtor';
      if (!Array.isArray(motion.recipients) || motion.recipients.length === 0) return 'recipients required';
      if (motion.recipients.some((r) => !s.players[r] || r === motion.debtorId)) return 'invalid recipient';
      if (!STAMPS.includes(motion.stampQuality)) return 'invalid stamp';
      return undefined;
    default:
      return 'unknown motion';
  }
}

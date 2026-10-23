import type { PlayerId } from './ids';
import type { HHmm } from './time';

export type PlayerRole = 'owner' | 'member';

export interface PlayerAppearance {
  color: string;
  emoji?: string;
}

export interface Player {
  id: PlayerId;
  name: string;
  role: PlayerRole;
  appearance: PlayerAppearance;
  /** Overrides the ruleset's default start time for this player. */
  startTimeOverride?: HHmm;
  archived: boolean;
}

/** `startTimeOverride: null` clears the override (undefined would not survive JSON sync). */
export type PlayerPatch = Partial<Pick<Player, 'name' | 'appearance' | 'archived'>> & { startTimeOverride?: HHmm | null };

/**
 * The scene's input contract. The scene never imports domain types; the app maps ledger state into this.
 */
export type Grade = 'AAA' | 'A' | 'B' | 'C' | 'D';
export type CupAgeStage = 'fresh' | 'cobweb' | 'ghost' | 'rip';

export interface CupView {
  id: string;
  age: CupAgeStage;
  /** Its late record has an open waive proposal: the cup wears a "심의 중" tag. */
  underReview?: boolean;
}

export interface TowerView {
  id: string;
  name: string;
  /** Sleeve / accent color, any CSS color string. */
  color: string;
  emoji?: string;
  grade: Grade;
  /** Bottom (oldest) → top (newest). */
  cups: CupView[];
  receivedCount: number;
  /** Holds the most outstanding cups (dishonorable crown). */
  crowned: boolean;
  /** This player's ballot on an open waive proposal, shown as a plaque on the pedestal. */
  ballot?: 'approve' | 'reject' | null;
  /** Paid everything off at least once and owes nothing now: a lotus blooms on the pedestal. */
  lotus?: boolean;
}

export interface SceneModel {
  towers: TowerView[];
  focusId: string | null;
  /** Frame the reaper's desk (the redemption counter) instead of a tower. */
  focusDesk?: boolean;
}

/**
 * Something that just happened and should be animated (DESIGN.md §4.1). The model already shows the final
 * state; events only say how to get there. The scene acknowledges each id once its animation is done.
 */
export type SceneEvent =
  | { id: string; kind: 'cupsAdded'; towerId: string; cupIds: string[] }
  | {
      id: string;
      kind: 'cupsRemoved';
      towerId: string;
      cupIds: string[];
      style: 'evaporate' | 'gold' | 'ascend';
      /** For 'ascend': which tower each redeemed cup flies to. */
      to?: Record<string, string>;
    }
  | { id: string; kind: 'paidOff'; towerId: string }
  | { id: string; kind: 'inspect'; towerId: string }
  | { id: string; kind: 'acknowledged'; towerId: string }
  | { id: string; kind: 'onTime'; towerId: string }
  | { id: string; kind: 'gradeChanged'; towerId: string; from: Grade; to: Grade }
  | { id: string; kind: 'verdict'; towerId: string; outcome: 'approved' | 'rejected' }
  | { id: string; kind: 'rulesChanged' };

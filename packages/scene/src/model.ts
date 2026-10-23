/**
 * The scene's input contract. The scene never imports domain types; the app maps ledger state into this.
 */
export type Grade = 'AAA' | 'A' | 'B' | 'C' | 'D';
export type CupAgeStage = 'fresh' | 'cobweb' | 'ghost' | 'rip';

export interface CupView {
  id: string;
  age: CupAgeStage;
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
}

export interface SceneModel {
  towers: TowerView[];
  focusId: string | null;
}

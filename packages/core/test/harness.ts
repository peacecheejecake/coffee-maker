import {
  asGroupId,
  asPlayerId,
  decide,
  emptyState,
  evolve,
  type Command,
  type DomainError,
  type LedgerEvent,
  type LedgerState,
  type PlayerId,
} from '../src';

export const GROUP = asGroupId('g1');
export const A = asPlayerId('A');
export const B = asPlayerId('B');
export const C = asPlayerId('C');
export const D = asPlayerId('D');
export const E = asPlayerId('E');

/**
 * In-memory ledger driven through `decide` + `evolve`, with a controllable clock.
 * Clock starts at 2026-10-23 09:00 KST (00:00Z).
 */
export function createLedger() {
  let state: LedgerState = emptyState();
  const events: LedgerEvent[] = [];
  let seq = 0;
  let now = Date.parse('2026-10-23T00:00:00.000Z');
  let today = '2026-10-23';

  const ctx = (actorId: PlayerId) => ({
    groupId: GROUP,
    actorId,
    now: new Date(now).toISOString(),
    today,
    newId: () => `e${String(++seq).padStart(4, '0')}`,
  });

  const ledger = {
    get state() {
      return state;
    },
    events,
    get now() {
      return new Date(now).toISOString();
    },
    apply(...evs: LedgerEvent[]) {
      for (const e of evs) {
        events.push(e);
        state = evolve(state, e);
      }
    },
    /** Runs a command that must succeed; returns the emitted events. */
    run(actor: PlayerId, cmd: Command): LedgerEvent[] {
      const d = decide(state, cmd, ctx(actor));
      if (!d.ok) throw new Error(`${cmd.type} failed: ${d.error.code} — ${d.error.message}`);
      ledger.apply(...d.value);
      return d.value;
    },
    /** Runs a command that must fail; returns the error. */
    fail(actor: PlayerId, cmd: Command): DomainError {
      const d = decide(state, cmd, ctx(actor));
      if (d.ok) throw new Error(`${cmd.type} unexpectedly succeeded`);
      return d.error;
    },
    /** Decides without applying, for building out-of-order or concurrent scenarios. */
    decideOnly(actor: PlayerId, cmd: Command): LedgerEvent[] {
      const d = decide(state, cmd, ctx(actor));
      if (!d.ok) throw new Error(`${cmd.type} failed: ${d.error.code}`);
      return d.value;
    },
    advanceMinutes(min: number) {
      now += min * 60_000;
    },
    setToday(date: string) {
      today = date;
    },
    /** Adds players; the first becomes owner (bootstrap). */
    join(...ids: PlayerId[]) {
      for (const id of ids) {
        const actor = state.playerOrder[0] ?? id;
        ledger.run(actor, { type: 'AddPlayer', id, name: `Player ${id}`, appearance: { color: '#888' } });
      }
    },
    /** Records a late arrival for `player` (recorded by `by`, default the owner); returns the event id. */
    late(player: PlayerId, arrivedAt = '09:10', opts: { by?: PlayerId; workDate?: string; cups?: number } = {}) {
      const [e] = ledger.run(opts.by ?? A, {
        type: 'RecordArrival',
        playerId: player,
        arrivedAt,
        ...(opts.workDate !== undefined && { workDate: opts.workDate }),
        ...(opts.cups !== undefined && { cupsOverride: opts.cups }),
        allowDuplicate: true,
      });
      if (!e) throw new Error('expected a late record');
      return e.id;
    },
    cups(player: PlayerId): number {
      return state.towers[player]?.cups.length ?? 0;
    },
  };
  return ledger;
}

export type Ledger = ReturnType<typeof createLedger>;

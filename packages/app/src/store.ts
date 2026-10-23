import {
  asGroupId,
  asPlayerId,
  currentRuleset,
  decide,
  DEFAULT_RULESET,
  emptyState,
  evolve,
  project,
  type Command,
  type Decision,
  type DomainError,
  type GroupId,
  type LedgerEvent,
  type LedgerState,
  type PlayerAppearance,
  type PlayerId,
} from '@coffee/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { systemClock, type Clock, type EventStore, type MetaStore } from './ports';
import { ulid } from './ulid';
import { deviceTimeZone, wallTime, type WallTime } from './wallClock';

export const UNDO_WINDOW_MS = 5_000;

export interface UndoOffer {
  /** Event the offer refers to, e.g. the LateRecorded just created. */
  eventId: string;
  kind: 'record' | 'proposal';
  command: Command;
  expiresAt: number;
}

export interface LedgerStoreState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  groupId: GroupId | null;
  /** Player using this device. Becomes the signed-in member in M3. */
  me: PlayerId | null;
  events: LedgerEvent[];
  ledger: LedgerState;
  undo: UndoOffer | null;
  loadError?: string;
}

export interface LedgerActions {
  /** Loads the active group from storage. */
  init(): Promise<void>;
  createGroup(input: { ownerName: string; appearance: PlayerAppearance; timeZone?: string }): Promise<Decision>;
  /** Replays prepared events into a fresh group (demo / import). */
  importGroup(groupId: GroupId, me: PlayerId, events: LedgerEvent[]): Promise<void>;
  dispatch(cmd: Command): Promise<Decision>;
  setMe(id: PlayerId): Promise<void>;
  undoLast(): Promise<Decision | undefined>;
  dismissUndo(): void;
  /** Current wall-clock time in the group's timezone. */
  wallNow(): WallTime;
  /** Current instant from the store's clock. UI time windows must use this, not `new Date()`. */
  nowIso(): string;
}

export type LedgerStore = StoreApi<LedgerStoreState & LedgerActions>;

export interface LedgerStoreDeps {
  events: EventStore;
  meta: MetaStore;
  clock?: Clock;
  newId?: () => string;
}

const META = { group: 'activeGroup', me: (g: GroupId) => `me:${g}` } as const;

const notReady = (): Decision => ({
  ok: false,
  error: { code: 'NotPermitted', message: 'No active group or user on this device' } satisfies DomainError,
});

export function createLedgerStore({
  events: eventStore,
  meta,
  clock = systemClock,
  newId = () => ulid(clock.now().getTime()),
}: LedgerStoreDeps): LedgerStore {
  // Commands run strictly one after another so the log order matches the order of user actions.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  return createStore<LedgerStoreState & LedgerActions>()((set, get) => {
    const timeZone = () => currentRuleset(get().ledger).timezone;

    const run = async (cmd: Command, actorId: PlayerId, groupId: GroupId): Promise<Decision> => {
      const now = clock.now();
      const decision = decide(get().ledger, cmd, {
        groupId,
        actorId,
        now: now.toISOString(),
        today: wallTime(now, timeZone()).workDate,
        newId,
      });
      if (!decision.ok || decision.value.length === 0) return decision;
      await eventStore.append(decision.value);
      set((s) => ({ events: [...s.events, ...decision.value], ledger: decision.value.reduce(evolve, s.ledger) }));
      return decision;
    };

    const undoOfferFor = (cmd: Command, produced: LedgerEvent[]): UndoOffer | null => {
      const first = produced[0];
      const expiresAt = clock.now().getTime() + UNDO_WINDOW_MS;
      if (cmd.type === 'RecordArrival' && first?.type === 'LateRecorded') {
        return { eventId: first.id, kind: 'record', command: { type: 'RetractLate', targetId: first.id }, expiresAt };
      }
      if (cmd.type === 'ProposeWaive' && first?.type === 'WaiveProposed') {
        return { eventId: first.id, kind: 'proposal', command: { type: 'WithdrawWaive', proposalId: first.id }, expiresAt };
      }
      return null;
    };

    return {
      status: 'idle',
      groupId: null,
      me: null,
      events: [],
      ledger: emptyState(),
      undo: null,

      async init() {
        set({ status: 'loading' });
        try {
          const groupId = await meta.get<GroupId>(META.group);
          if (!groupId) {
            set({ status: 'ready' });
            return;
          }
          const events = await eventStore.load(groupId);
          const me = (await meta.get<PlayerId>(META.me(groupId))) ?? null;
          set({ status: 'ready', groupId, me, events, ledger: project(events) });
        } catch (e) {
          set({ status: 'error', loadError: e instanceof Error ? e.message : String(e) });
        }
      },

      createGroup: ({ ownerName, appearance, timeZone: tz }) =>
        serial(async () => {
          const groupId = asGroupId(newId());
          const me = asPlayerId(newId());
          set({ groupId, me, events: [], ledger: emptyState(), undo: null });
          const added = await run({ type: 'AddPlayer', id: me, name: ownerName, appearance }, me, groupId);
          if (!added.ok) return added;
          const rules = await run(
            { type: 'ChangeRuleset', ruleset: { ...DEFAULT_RULESET, timezone: tz ?? deviceTimeZone() } },
            me,
            groupId,
          );
          await meta.set(META.group, groupId);
          await meta.set(META.me(groupId), me);
          return rules.ok ? { ok: true, value: [...added.value, ...rules.value] } : rules;
        }),

      importGroup: (groupId, me, events) =>
        serial(async () => {
          await eventStore.append(events);
          await meta.set(META.group, groupId);
          await meta.set(META.me(groupId), me);
          set({ groupId, me, events, ledger: project(events), undo: null });
        }),

      dispatch: (cmd) =>
        serial(async () => {
          const { groupId, me } = get();
          if (!groupId || !me) return notReady();
          const decision = await run(cmd, me, groupId);
          if (decision.ok && decision.value.length > 0) {
            const offer = undoOfferFor(cmd, decision.value);
            if (offer) set({ undo: offer });
          }
          return decision;
        }),

      async setMe(id) {
        const { groupId } = get();
        if (!groupId) return;
        await meta.set(META.me(groupId), id);
        set({ me: id, undo: null });
      },

      async undoLast() {
        const offer = get().undo;
        set({ undo: null });
        if (!offer || clock.now().getTime() > offer.expiresAt) return undefined;
        return get().dispatch(offer.command);
      },

      dismissUndo() {
        set({ undo: null });
      },

      wallNow: () => wallTime(clock.now(), timeZone()),
      nowIso: () => clock.now().toISOString(),
    };
  });
}

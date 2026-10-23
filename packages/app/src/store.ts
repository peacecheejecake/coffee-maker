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
import { canonicalOrder, mergeEvents } from './ordering';
import {
  systemClock,
  type AssetStore,
  type Clock,
  type EventStore,
  type MetaStore,
  type PushResult,
  type RemoteSync,
} from './ports';
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

export type SyncStatus = 'local' | 'offline' | 'syncing' | 'synced';

export interface Rejection {
  event: LedgerEvent;
  reason: string;
}

export interface LedgerStoreState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  groupId: GroupId | null;
  /** Player this device acts as. With sync, the player claimed by the signed-in account. */
  me: PlayerId | null;
  /** Canonical order: confirmed by seq, then pending. */
  events: LedgerEvent[];
  ledger: LedgerState;
  undo: UndoOffer | null;
  loadError?: string;
  /** 'local' when no remote is configured. */
  sync: SyncStatus;
  inviteCode: string | null;
  /** Events from other devices since the UI last drained them (for toasts and, later, animations). */
  remoteFeed: LedgerEvent[];
  /** Local events the server refused (e.g. a vote after the deadline); removed from the ledger. */
  rejections: Rejection[];
}

export interface LedgerActions {
  /** Loads the active group from storage. */
  init(): Promise<void>;
  createGroup(input: { ownerName: string; appearance: PlayerAppearance; timeZone?: string }): Promise<Decision>;
  /** Replays prepared events into a fresh, local-only group (demo / import). */
  importGroup(groupId: GroupId, me: PlayerId, events: LedgerEvent[]): Promise<void>;
  /** Joins a shared group by invite code and downloads its ledger. Needs a remote. */
  joinByInvite(code: string): Promise<void>;
  /** Players in the group that no account has claimed yet. */
  unclaimedPlayers(): Promise<PlayerId[]>;
  /** Binds this account to an existing player (after joining). */
  claim(playerId: PlayerId): Promise<void>;
  /** Creates a new player for this account (after joining). */
  registerSelf(name: string, appearance: PlayerAppearance): Promise<Decision>;
  dispatch(cmd: Command): Promise<Decision>;
  /** Local-only groups: pick who uses this device. Shared groups bind it via claim(). */
  setMe(id: PlayerId): Promise<void>;
  undoLast(): Promise<Decision | undefined>;
  dismissUndo(): void;
  /** Current wall-clock time in the group's timezone. */
  wallNow(): WallTime;
  /** Current instant from the store's clock. UI time windows must use this, not `new Date()`. */
  nowIso(): string;

  // ── used by the sync engine ──
  applyRemote(events: LedgerEvent[]): Promise<void>;
  confirm(results: PushResult[]): Promise<void>;
  setSync(status: SyncStatus): void;
  drainRemoteFeed(): LedgerEvent[];
  drainRejections(): Rejection[];

  /** Stores an evidence photo for the active group. Null when photos are unsupported. */
  putEvidence(blob: Blob): Promise<string | null>;
  evidenceUrl(assetId: string): Promise<string | null>;
}

export type LedgerStore = StoreApi<LedgerStoreState & LedgerActions> & {
  remote: RemoteSync | null;
  /** True when evidence photos can be stored. */
  supportsEvidence: boolean;
  /** Makes sure a group created offline exists on the server. False for local-only groups. */
  ensureRegistered(): Promise<boolean>;
};

export interface LedgerStoreDeps {
  events: EventStore;
  meta: MetaStore;
  /** Omit for a local-only app. */
  remote?: RemoteSync | null;
  /** Evidence photo storage; without it photos are not offered. */
  assets?: AssetStore | null;
  clock?: Clock;
  newId?: () => string;
}

const META = {
  group: 'activeGroup',
  me: (g: GroupId) => `me:${g}`,
  invite: (g: GroupId) => `invite:${g}`,
  /** Set once the group exists on the server (a group created offline is registered later). */
  registered: (g: GroupId) => `registered:${g}`,
  shared: (g: GroupId) => `shared:${g}`,
} as const;

const fail = (code: DomainError['code'], message: string): Decision => ({ ok: false, error: { code, message } });

export function createLedgerStore({
  events: eventStore,
  meta,
  remote = null,
  assets = null,
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

  const store = createStore<LedgerStoreState & LedgerActions>()((set, get) => {
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
      // New local events are pending, so they go last; state can be extended incrementally.
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

    const loadGroup = async (groupId: GroupId) => {
      const events = canonicalOrder(await eventStore.load(groupId));
      const me = (await meta.get<PlayerId>(META.me(groupId))) ?? null;
      const inviteCode = (await meta.get<string>(META.invite(groupId))) ?? null;
      const shared = (await meta.get<boolean>(META.shared(groupId))) ?? false;
      set({
        groupId,
        me,
        events,
        ledger: project(events),
        inviteCode,
        undo: null,
        sync: remote && shared ? 'syncing' : 'local',
      });
    };

    return {
      status: 'idle',
      groupId: null,
      me: null,
      events: [],
      ledger: emptyState(),
      undo: null,
      sync: 'local',
      inviteCode: null,
      remoteFeed: [],
      rejections: [],

      async init() {
        set({ status: 'loading' });
        try {
          const groupId = await meta.get<GroupId>(META.group);
          if (groupId) await loadGroup(groupId);
          set({ status: 'ready' });
        } catch (e) {
          set({ status: 'error', loadError: e instanceof Error ? e.message : String(e) });
        }
      },

      createGroup: ({ ownerName, appearance, timeZone: tz }) =>
        serial(async () => {
          const groupId = asGroupId(newId());
          const me = asPlayerId(newId());
          set({ groupId, me, events: [], ledger: emptyState(), undo: null, inviteCode: null });
          const added = await run({ type: 'AddPlayer', id: me, name: ownerName, appearance }, me, groupId);
          if (!added.ok) return added;
          const rules = await run(
            { type: 'ChangeRuleset', ruleset: { ...DEFAULT_RULESET, timezone: tz ?? deviceTimeZone() } },
            me,
            groupId,
          );
          await meta.set(META.group, groupId);
          await meta.set(META.me(groupId), me);
          if (remote) {
            await meta.set(META.shared(groupId), true);
            set({ sync: 'syncing' });
            // Registration is retried by the sync engine if we are offline now.
            await registerGroup(groupId, me, ownerName).catch(() => set({ sync: 'offline' }));
          }
          return rules.ok ? { ok: true, value: [...added.value, ...rules.value] } : rules;
        }),

      importGroup: (groupId, me, events) =>
        serial(async () => {
          await eventStore.append(events);
          await meta.set(META.group, groupId);
          await meta.set(META.me(groupId), me);
          await loadGroup(groupId);
        }),

      joinByInvite: (code) =>
        serial(async () => {
          if (!remote) throw new Error('Sync is not configured');
          await remote.ensureSession();
          const { groupId, playerId } = await remote.joinGroup(code);
          await meta.set(META.group, groupId);
          await meta.set(META.shared(groupId), true);
          await meta.set(META.registered(groupId), true);
          if (playerId) await meta.set(META.me(groupId), playerId);
          const pulled = await remote.pull(groupId, 0);
          await eventStore.put(pulled);
          await loadGroup(groupId);
          set({ inviteCode: code.toUpperCase() });
          await meta.set(META.invite(groupId), code.toUpperCase());
        }),

      async unclaimedPlayers() {
        const { groupId, ledger } = get();
        if (!remote || !groupId) return [];
        const claimed = new Set(await remote.claimedPlayers(groupId));
        return ledger.playerOrder.filter((id) => !claimed.has(id) && !ledger.players[id]?.archived);
      },

      async claim(playerId) {
        const { groupId } = get();
        if (!remote || !groupId) return;
        await remote.claimPlayer(groupId, playerId);
        await meta.set(META.me(groupId), playerId);
        set({ me: playerId });
      },

      async registerSelf(name, appearance) {
        const { groupId } = get();
        if (!remote || !groupId) return fail('NotPermitted', 'Sync is not configured');
        const id = asPlayerId(newId());
        await remote.claimPlayer(groupId, id);
        await meta.set(META.me(groupId), id);
        set({ me: id });
        return serial(() => run({ type: 'AddPlayer', id, name, appearance }, id, groupId));
      },

      dispatch: (cmd) =>
        serial(async () => {
          const { groupId, me } = get();
          if (!groupId || !me) return fail('NotPermitted', 'No active group or user on this device');
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

      applyRemote: (incoming) =>
        serial(async () => {
          const { groupId, events, me } = get();
          const relevant = incoming.filter((e) => e.groupId === groupId);
          if (relevant.length === 0) return;
          const merged = mergeEvents(events, relevant);
          if (merged.added.length === 0 && merged.updated.length === 0) return;
          await eventStore.put([...merged.added, ...merged.updated]);
          const fromOthers = merged.added.filter((e) => e.actorId !== me);
          set((s) => ({
            events: merged.events,
            ledger: project(merged.events),
            remoteFeed: [...s.remoteFeed, ...fromOthers],
          }));
        }),

      confirm: (results) =>
        serial(async () => {
          const byId = new Map<string, LedgerEvent>(get().events.map((e) => [e.id, e]));
          const accepted: LedgerEvent[] = [];
          const rejected: Rejection[] = [];
          for (const r of results) {
            const e = byId.get(r.id);
            if (!e || e.seq !== undefined) continue;
            if (r.error || r.seq === undefined) rejected.push({ event: e, reason: r.error ?? 'unknown' });
            else accepted.push({ ...e, seq: r.seq, ...(r.serverAt && { serverAt: r.serverAt }) });
          }
          if (accepted.length === 0 && rejected.length === 0) return;
          await eventStore.put(accepted);
          await eventStore.remove(rejected.map((r) => r.event.id));
          const dropped = new Set(rejected.map((r) => r.event.id));
          const merged = mergeEvents(
            get().events.filter((e) => !dropped.has(e.id)),
            accepted,
          );
          set((s) => ({
            events: merged.events,
            ledger: project(merged.events),
            rejections: [...s.rejections, ...rejected],
          }));
        }),

      setSync(sync) {
        if (get().sync !== sync) set({ sync });
      },

      drainRemoteFeed() {
        const feed = get().remoteFeed;
        if (feed.length) set({ remoteFeed: [] });
        return feed;
      },

      async putEvidence(blob) {
        const { groupId } = get();
        return assets && groupId ? assets.put(groupId, blob) : null;
      },

      async evidenceUrl(assetId) {
        const { groupId } = get();
        return assets && groupId ? assets.url(groupId, assetId) : null;
      },

      drainRejections() {
        const r = get().rejections;
        if (r.length) set({ rejections: [] });
        return r;
      },
    };
  });

  async function registerGroup(groupId: GroupId, me: PlayerId, name: string) {
    if (!remote) return;
    await remote.ensureSession();
    const { inviteCode } = await remote.createGroup({ groupId, playerId: me, name });
    await meta.set(META.registered(groupId), true);
    await meta.set(META.invite(groupId), inviteCode);
    store.setState({ inviteCode });
  }

  /** For the sync engine: make sure a group created offline exists on the server before pushing. */
  const ensureRegistered = async () => {
    const { groupId, me, ledger } = store.getState();
    if (!remote || !groupId || !me) return false;
    if (!(await meta.get<boolean>(META.shared(groupId)))) return false;
    if (await meta.get<boolean>(META.registered(groupId))) return true;
    await registerGroup(groupId, me, ledger.players[me]?.name ?? '');
    return true;
  };

  return Object.assign(store, { remote, supportsEvidence: assets !== null, ensureRegistered });
}

import type { GroupId } from '@coffee/core';
import { isConfirmed, lastSeq } from './ordering';
import type { LedgerStore } from './store';

export interface SyncOptions {
  /** First retry delay; doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
  /** Browser connectivity hooks; defaults to window online/offline + visibility events. */
  connectivity?: Connectivity;
}

export interface Connectivity {
  isOnline(): boolean;
  /** Calls back when the device comes back online or the app is foregrounded. */
  onWake(cb: () => void): () => void;
}

const browserConnectivity: Connectivity = {
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  onWake(cb) {
    if (typeof window === 'undefined') return () => {};
    const onVisible = () => document.visibilityState === 'visible' && cb();
    window.addEventListener('online', cb);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', cb);
      document.removeEventListener('visibilitychange', onVisible);
    };
  },
};

/**
 * Keeps the local log and the server in step (DESIGN.md §5.5):
 * push pending events (idempotent by id) → pull anything newer than our last seq → live subscription.
 * Every (re)subscription and wake-up triggers a pull, which fills whatever a dropped socket missed.
 * Returns a stop function.
 */
export function startSync(store: LedgerStore, opts: SyncOptions = {}): () => void {
  const remote = store.remote;
  if (!remote) return () => {};
  const { retryMs = 1_000, maxRetryMs = 30_000, connectivity = browserConnectivity } = opts;

  let stopped = false;
  let running = false;
  let again = false;
  let delay = retryMs;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let subscribedGroup: GroupId | null = null;

  const scheduleRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void kick(), delay);
    delay = Math.min(maxRetryMs, delay * 2);
  };

  async function cycle(): Promise<void> {
    const shared = await store.ensureRegistered();
    const { groupId } = store.getState();
    if (!shared || !groupId) {
      store.getState().setSync('local');
      return;
    }
    if (!connectivity.isOnline()) {
      store.getState().setSync('offline');
      // The wake-up hook normally brings us back; retry anyway in case the event never fires.
      scheduleRetry();
      return;
    }
    store.getState().setSync('syncing');
    resubscribe(groupId);

    const pending = store.getState().events.filter((e) => !isConfirmed(e) && e.groupId === groupId);
    if (pending.length > 0) {
      // Small batches keep a single bad event from delaying everything after it for long.
      for (let i = 0; i < pending.length; i += 50) {
        await store.getState().confirm(await remote!.push(pending.slice(i, i + 50)));
      }
    }
    await store.getState().applyRemote(await remote!.pull(groupId, lastSeq(store.getState().events)));

    const stillPending = store.getState().events.some((e) => !isConfirmed(e));
    store.getState().setSync(stillPending ? 'syncing' : 'synced');
  }

  async function kick(): Promise<void> {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await cycle();
      } while (again && !stopped);
      delay = retryMs;
    } catch {
      store.getState().setSync('offline');
      scheduleRetry();
    } finally {
      running = false;
    }
  }

  function resubscribe(groupId: GroupId) {
    if (subscribedGroup === groupId) return;
    unsubscribe?.();
    subscribedGroup = groupId;
    unsubscribe = remote!.subscribe(
      groupId,
      (events) => void store.getState().applyRemote(events),
      (status) => {
        if (status === 'subscribed') void kick();
        else if (status === 'closed') {
          subscribedGroup = null;
          scheduleRetry();
        }
      },
    );
  }

  // New local events, a group switch, or registration/claim finishing (invite code, me) → run a cycle.
  const unwatch = store.subscribe((s, prev) => {
    if (
      s.groupId !== prev.groupId ||
      s.me !== prev.me ||
      s.inviteCode !== prev.inviteCode ||
      s.events.some((e) => !isConfirmed(e) && !prev.events.includes(e))
    ) {
      void kick();
    }
  });
  const unwake = connectivity.onWake(() => void kick());
  void kick();

  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    unwatch();
    unwake();
    unsubscribe?.();
  };
}

import type { LedgerEvent } from '@coffee/core';

export const isConfirmed = (e: LedgerEvent) => e.seq !== undefined;

/** Highest server sequence number seen, 0 if none. */
export const lastSeq = (events: readonly LedgerEvent[]) =>
  events.reduce((max, e) => (e.seq !== undefined && e.seq > max ? e.seq : max), 0);

/**
 * Canonical replay order (DESIGN.md §5.5): server-confirmed events by seq, then events still waiting to be
 * pushed in the order they were created on this device. Every device converges once everything is confirmed.
 */
export function canonicalOrder(events: readonly LedgerEvent[]): LedgerEvent[] {
  const confirmed = events.filter(isConfirmed).sort((a, b) => a.seq! - b.seq!);
  const pending = events.filter((e) => !isConfirmed(e));
  return [...confirmed, ...pending];
}

/** Merges `incoming` into `current` by id; an incoming confirmed copy replaces a local pending one. */
export function mergeEvents(current: readonly LedgerEvent[], incoming: readonly LedgerEvent[]) {
  const byId = new Map(current.map((e) => [e.id, e] as const));
  const added: LedgerEvent[] = [];
  const updated: LedgerEvent[] = [];
  for (const e of incoming) {
    const old = byId.get(e.id);
    if (!old) {
      byId.set(e.id, e);
      added.push(e);
    } else if (!isConfirmed(old) && isConfirmed(e)) {
      byId.set(e.id, e);
      updated.push(e);
    }
  }
  return { events: canonicalOrder([...byId.values()]), added, updated };
}

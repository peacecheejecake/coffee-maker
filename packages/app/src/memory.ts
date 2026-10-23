import type { GroupId, LedgerEvent } from '@coffee/core';
import type { EventStore, MetaStore } from './ports';

/** Reference in-memory implementations, for tests and storage-less environments. */
export function createMemoryStores(): { events: EventStore & { all: LedgerEvent[] }; meta: MetaStore } {
  const all: LedgerEvent[] = [];
  const kv = new Map<string, unknown>();
  return {
    events: {
      all,
      load: async (groupId: GroupId) => all.filter((e) => e.groupId === groupId),
      append: async (events) => {
        for (const e of events) if (!all.some((x) => x.id === e.id)) all.push(e);
      },
      put: async (events) => {
        for (const e of events) {
          const i = all.findIndex((x) => x.id === e.id);
          if (i === -1) all.push(e);
          else all[i] = e;
        }
      },
      remove: async (ids) => {
        for (const id of ids) {
          const i = all.findIndex((x) => x.id === id);
          if (i !== -1) all.splice(i, 1);
        }
      },
    },
    meta: {
      get: async <T>(key: string) => kv.get(key) as T | undefined,
      set: async <T>(key: string, value: T) => {
        kv.set(key, value);
      },
    },
  };
}

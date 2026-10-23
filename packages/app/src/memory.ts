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
        all.push(...events);
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

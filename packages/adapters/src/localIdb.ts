import type { EventStore, MetaStore } from '@coffee/app';
import type { GroupId, LedgerEvent } from '@coffee/core';
import { upcast, type RawEvent } from '@coffee/core';
import Dexie, { type EntityTable } from 'dexie';

interface EventRow {
  /** Local insertion order; the replay order for this device. */
  localSeq?: number;
  id: string;
  groupId: string;
  event: LedgerEvent;
}

interface MetaRow {
  key: string;
  value: unknown;
}

class CoffeeDb extends Dexie {
  events!: EntityTable<EventRow, 'localSeq'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      events: '++localSeq, &id, groupId',
      meta: '&key',
    });
  }
}

/** Offline-first storage in the browser's IndexedDB (DESIGN.md §5.5). */
export function createLocalIdbStores(dbName = 'coffee-maker'): { events: EventStore; meta: MetaStore; db: Dexie } {
  const db = new CoffeeDb(dbName);
  return {
    db,
    events: {
      async load(groupId: GroupId) {
        const rows = await db.events.where('groupId').equals(groupId).sortBy('localSeq');
        return rows.map((r) => upcast(r.event as unknown as RawEvent));
      },
      async append(events) {
        // Idempotent by event id: re-appending an event (e.g. replayed from sync) is a no-op.
        await db.transaction('rw', db.events, async () => {
          for (const event of events) {
            if (await db.events.where('id').equals(event.id).count()) continue;
            await db.events.add({ id: event.id, groupId: event.groupId, event });
          }
        });
      },
      async put(events) {
        await db.transaction('rw', db.events, async () => {
          for (const event of events) {
            const existing = await db.events.where('id').equals(event.id).first();
            if (existing) await db.events.update(existing.localSeq!, { event });
            else await db.events.add({ id: event.id, groupId: event.groupId, event });
          }
        });
      },
      async remove(ids) {
        await db.events.where('id').anyOf([...ids]).delete();
      },
    },
    meta: {
      get: async <T>(key: string) => (await db.meta.get(key))?.value as T | undefined,
      set: async <T>(key: string, value: T) => {
        await db.meta.put({ key, value });
      },
    },
  };
}

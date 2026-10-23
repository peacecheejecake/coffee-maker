import type { AssetStore, EventStore, MetaStore } from '@coffee/app';
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

interface AssetRow {
  key: string;
  blob: Blob;
}

interface MetaRow {
  key: string;
  value: unknown;
}

class CoffeeDb extends Dexie {
  events!: EntityTable<EventRow, 'localSeq'>;
  meta!: EntityTable<MetaRow, 'key'>;
  assets!: EntityTable<AssetRow, 'key'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      events: '++localSeq, &id, groupId',
      meta: '&key',
    });
    this.version(2).stores({ assets: '&key' });
  }
}

/** Offline-first storage in the browser's IndexedDB (DESIGN.md §5.5). */
export function createLocalIdbStores(dbName = 'coffee-maker'): {
  events: EventStore;
  meta: MetaStore;
  assets: AssetStore;
  db: Dexie;
} {
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
    assets: {
      async put(groupId, blob) {
        const id = crypto.randomUUID();
        await db.assets.put({ key: `${groupId}/${id}`, blob });
        return id;
      },
      async url(groupId, id) {
        const row = await db.assets.get(`${groupId}/${id}`);
        return row ? URL.createObjectURL(row.blob) : null;
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

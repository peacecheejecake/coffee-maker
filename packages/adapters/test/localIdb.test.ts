import 'fake-indexeddb/auto';
import { createLedgerStore } from '@coffee/app';
import { asPlayerId } from '@coffee/core';
import { describe, expect, it } from 'vitest';
import { createLocalIdbStores } from '../src';

describe('IndexedDB stores', () => {
  it('round-trips a ledger through a reload, idempotently', async () => {
    const name = `t-${Math.random()}`;
    const first = createLocalIdbStores(name);
    const store = createLedgerStore(first);
    await store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, timeZone: 'Asia/Seoul' });
    await store.getState().dispatch({ type: 'AddPlayer', id: asPlayerId('B'), name: '민수', appearance: { color: '#0f0' } });
    await store.getState().dispatch({ type: 'RecordArrival', playerId: asPlayerId('B'), workDate: '2026-10-20', arrivedAt: '09:30' });

    const events = store.getState().events;
    await first.events.append(events); // duplicates ignored
    first.db.close();

    const second = createLocalIdbStores(name);
    const reloaded = createLedgerStore(second);
    await reloaded.getState().init();
    expect(reloaded.getState().events.map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(reloaded.getState().ledger).toEqual(store.getState().ledger);
    expect(reloaded.getState().me).toBe(store.getState().me);
  });

  it('keeps groups apart', async () => {
    const { events } = createLocalIdbStores(`t-${Math.random()}`);
    const base = { actorId: asPlayerId('A'), at: '2026-10-23T00:00:00.000Z', schemaVersion: 1 };
    await events.append([
      { ...base, id: 'e1', groupId: 'g1', type: 'PlayerJoined', player: { id: asPlayerId('A'), name: 'a', role: 'owner', appearance: { color: '#000' }, archived: false } },
      { ...base, id: 'e2', groupId: 'g2', type: 'PlayerJoined', player: { id: asPlayerId('A'), name: 'a', role: 'owner', appearance: { color: '#000' }, archived: false } },
    ] as never);
    expect((await events.load('g1' as never)).map((e) => e.id)).toEqual(['e1']);
  });
});

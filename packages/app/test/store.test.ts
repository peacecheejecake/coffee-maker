import { asPlayerId, outstanding, type PlayerId } from '@coffee/core';
import { describe, expect, it } from 'vitest';
import { createLedgerStore, createMemoryStores, UNDO_WINDOW_MS, ulid, wallTime } from '../src';

/** 2026-10-23 09:12 in Seoul. */
function setup(start = Date.parse('2026-10-23T00:12:00Z')) {
  let now = start;
  let seq = 0;
  const stores = createMemoryStores();
  const store = createLedgerStore({
    ...stores,
    clock: { now: () => new Date(now) },
    newId: () => `id${String(++seq).padStart(3, '0')}`,
  });
  return { store, stores, advance: (ms: number) => (now += ms) };
}

async function withGroup() {
  const s = setup();
  const r = await s.store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, timeZone: 'Asia/Seoul' });
  expect(r.ok).toBe(true);
  const { dispatch } = s.store.getState();
  await dispatch({ type: 'AddPlayer', id: asPlayerId('B'), name: '민수', appearance: { color: '#0f0' } });
  await dispatch({ type: 'AddPlayer', id: asPlayerId('C'), name: '하나', appearance: { color: '#00f' } });
  return s;
}

describe('wallTime', () => {
  it('converts to the group timezone', () => {
    const at = new Date('2026-10-22T23:59:40Z');
    expect(wallTime(at, 'Asia/Seoul')).toEqual({ workDate: '2026-10-23', hhmm: '08:59' });
    expect(wallTime(at, 'UTC')).toEqual({ workDate: '2026-10-22', hhmm: '23:59' });
  });
});

describe('ulid', () => {
  it('is 26 chars, time-sortable', () => {
    const a = ulid(1_000);
    const b = ulid(2_000);
    expect(a).toHaveLength(26);
    expect(a < b).toBe(true);
    expect(ulid(0, (x) => x.fill(0))).toBe('0'.repeat(26));
  });
});

describe('ledger store', () => {
  it('starts empty when nothing is stored', async () => {
    const { store } = setup();
    await store.getState().init();
    expect(store.getState()).toMatchObject({ status: 'ready', groupId: null, me: null });
  });

  it('creates a group with the device timezone ruleset and persists it', async () => {
    const { store, stores } = await withGroup();
    const st = store.getState();
    expect(st.me).toBe('id002');
    expect(st.ledger.players[st.me as PlayerId]?.role).toBe('owner');
    expect(st.ledger.rulesets[0]?.ruleset.timezone).toBe('Asia/Seoul');
    expect(stores.events.all.map((e) => e.type)).toEqual(['PlayerJoined', 'RulesetChanged', 'PlayerJoined', 'PlayerJoined']);

    // A fresh store over the same storage restores everything.
    const again = createLedgerStore({ ...stores });
    await again.getState().init();
    expect(again.getState()).toMatchObject({ status: 'ready', groupId: st.groupId, me: st.me });
    expect(again.getState().ledger).toEqual(st.ledger);
  });

  it('dispatches with today in the group timezone and offers an undo', async () => {
    const { store } = await withGroup();
    const r = await store.getState().dispatch({ type: 'RecordArrival', playerId: asPlayerId('B'), arrivedAt: '09:12' });
    expect(r.ok && r.value[0]).toMatchObject({ type: 'LateRecorded', workDate: '2026-10-23', minutesLate: 12 });
    expect(outstanding(store.getState().ledger, asPlayerId('B'))).toBe(1);
    expect(store.getState().undo).toMatchObject({ kind: 'record', command: { type: 'RetractLate' } });

    await store.getState().undoLast();
    expect(outstanding(store.getState().ledger, asPlayerId('B'))).toBe(0);
    expect(store.getState().undo).toBeNull();
  });

  it('undo expires', async () => {
    const { store, advance } = await withGroup();
    await store.getState().dispatch({ type: 'RecordArrival', playerId: asPlayerId('B'), arrivedAt: '09:12' });
    advance(UNDO_WINDOW_MS + 1);
    expect(await store.getState().undoLast()).toBeUndefined();
    expect(outstanding(store.getState().ledger, asPlayerId('B'))).toBe(1);
  });

  it('a waive proposal offers withdraw as undo', async () => {
    const { store } = await withGroup();
    const r = await store.getState().dispatch({ type: 'RecordArrival', playerId: asPlayerId('B'), arrivedAt: '09:30' });
    const targetId = r.ok ? r.value[0]!.id : (undefined as never);
    await store.getState().dispatch({ type: 'ProposeWaive', targetId, reason: '폭설' });
    expect(store.getState().undo?.kind).toBe('proposal');
    await store.getState().undoLast();
    const p = Object.values(store.getState().ledger.proposals)[0];
    expect(p?.status).toBe('withdrawn');
  });

  it('on-time arrivals and domain errors leave state and storage untouched', async () => {
    const { store, stores } = await withGroup();
    const before = stores.events.all.length;
    const onTime = await store.getState().dispatch({ type: 'RecordArrival', playerId: asPlayerId('B'), arrivedAt: '09:01' });
    expect(onTime).toEqual({ ok: true, value: [] });
    const bad = await store.getState().dispatch({ type: 'RecordArrival', playerId: asPlayerId('Z'), arrivedAt: '09:30' });
    expect(bad.ok).toBe(false);
    expect(stores.events.all).toHaveLength(before);
    expect(store.getState().undo).toBeNull();
  });

  it('switching the device user changes the actor', async () => {
    const { store } = await withGroup();
    await store.getState().setMe(asPlayerId('B'));
    const r = await store.getState().dispatch({ type: 'RecordArrival', playerId: asPlayerId('C'), arrivedAt: '09:30' });
    expect(r.ok && r.value[0]!.actorId).toBe('B');
  });

  it('refuses commands without a group', async () => {
    const { store } = setup();
    const r = await store.getState().dispatch({ type: 'RecordArrival', playerId: asPlayerId('B'), arrivedAt: '09:30' });
    expect(r.ok).toBe(false);
  });

  it('serialises concurrent dispatches in call order', async () => {
    const { store } = await withGroup();
    const { dispatch } = store.getState();
    await Promise.all([
      dispatch({ type: 'RecordArrival', playerId: asPlayerId('B'), arrivedAt: '09:30' }),
      dispatch({ type: 'RecordArrival', playerId: asPlayerId('B'), arrivedAt: '09:40' }),
    ]);
    // The second sees the first and is refused as a duplicate date.
    expect(outstanding(store.getState().ledger, asPlayerId('B'))).toBe(1);
  });

  it('imports a prepared group', async () => {
    const source = await withGroup();
    const { store } = setup();
    const st = source.store.getState();
    await store.getState().importGroup(st.groupId!, st.me!, st.events);
    expect(store.getState().ledger).toEqual(st.ledger);
  });

  it('reports storage failures on init', async () => {
    const { stores } = setup();
    const store = createLedgerStore({
      ...stores,
      meta: { ...stores.meta, get: async () => 'g' as never },
      events: { ...stores.events, load: async () => Promise.reject(new Error('disk')) },
    });
    await store.getState().init();
    expect(store.getState()).toMatchObject({ status: 'error', loadError: 'disk' });
  });
});

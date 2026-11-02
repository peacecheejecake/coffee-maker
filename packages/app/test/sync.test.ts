import { asPlayerId, outstanding, type PlayerId } from '@coffee/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerStore, createMemoryStores, startSync, type LedgerStore } from '../src';
import { FakeServer } from './fakeServer';

const flush = async (rounds = 20) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};

let clockMs = Date.parse('2026-10-23T00:30:00Z');
const clock = { now: () => new Date(clockMs) };
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((s) => s());
  clockMs = Date.parse('2026-10-23T00:30:00Z');
});

/** Network switch whose changes wake the sync engine, like the browser's `online` event. */
function makeNet(initial: boolean) {
  const listeners = new Set<() => void>();
  let online = initial;
  return {
    get online() {
      return online;
    },
    set online(v: boolean) {
      online = v;
      if (v) listeners.forEach((l) => l());
    },
    connectivity: {
      isOnline: () => online,
      onWake: (cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
  };
}

function device(server: FakeServer, userId: string, net = makeNet(true)) {
  let n = 0;
  const store = createLedgerStore({
    ...createMemoryStores(),
    remote: server.remoteFor(userId, net),
    clock,
    newId: () => `${userId}-${String(++n).padStart(4, '0')}-${Math.random().toString(36).slice(2, 6)}`,
  });
  stops.push(startSync(store, { retryMs: 5, maxRetryMs: 20, connectivity: net.connectivity }));
  return { store, net };
}

/** Owner device A creates the group; device B joins and registers as 민수. */
async function twoDevices() {
  const server = new FakeServer(clock.now);
  const a = device(server, 'userA');
  await a.store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, mode: 'shared', timeZone: 'Asia/Seoul' });
  await flush();
  const code = a.store.getState().inviteCode!;
  const b = device(server, 'userB');
  await b.store.getState().joinByInvite(code);
  await b.store.getState().registerSelf('민수', { color: '#0f0' });
  await flush();
  return { server, a: a.store, b: b.store, bNet: b.net, code };
}

const meOf = (s: LedgerStore) => s.getState().me as PlayerId;

describe('sync', () => {
  it('creating a group registers it and confirms the first events', async () => {
    const server = new FakeServer(clock.now);
    const { store } = device(server, 'userA');
    await store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, mode: 'shared' });
    await flush();
    expect(store.getState().inviteCode).toBe('INV1');
    expect(store.getState().sync).toBe('synced');
    expect(store.getState().events.every((e) => e.seq !== undefined && e.serverAt)).toBe(true);
    expect(server.events).toHaveLength(2);
  });

  it('a joiner downloads the ledger, registers, and both devices converge live', async () => {
    const { a, b } = await twoDevices();
    expect(a.getState().ledger.players[meOf(b)]?.name).toBe('민수');

    await a.getState().dispatch({ type: 'RecordArrival', playerId: meOf(b), arrivedAt: '09:20' });
    await flush();
    expect(outstanding(b.getState().ledger, meOf(b))).toBe(1);
    expect(b.getState().remoteFeed.map((e) => e.type)).toContain('LateRecorded');
    expect(b.getState().ledger).toEqual(a.getState().ledger);
  });

  it('offline records are kept and pushed when back online', async () => {
    const { a, b, bNet } = await twoDevices();
    bNet.online = false;
    await b.getState().dispatch({ type: 'RecordArrival', playerId: meOf(a), arrivedAt: '09:30' });
    await flush();
    expect(b.getState().sync).toBe('offline');
    expect(outstanding(a.getState().ledger, meOf(a))).toBe(0);

    bNet.online = true;
    await flush(60);
    expect(outstanding(a.getState().ledger, meOf(a))).toBe(1);
    expect(b.getState().sync).toBe('synced');
  });

  it('concurrent edits on both devices converge to the same state', async () => {
    const { a, b } = await twoDevices();
    await Promise.all([
      a.getState().dispatch({ type: 'RecordArrival', playerId: meOf(b), arrivedAt: '09:20' }),
      b.getState().dispatch({ type: 'RecordArrival', playerId: meOf(a), arrivedAt: '09:40' }),
      b.getState().dispatch({ type: 'RecordArrival', playerId: meOf(b), arrivedAt: '09:50', allowDuplicate: true }),
    ]);
    await flush(60);
    expect(a.getState().events.map((e) => e.id)).toEqual(b.getState().events.map((e) => e.id));
    expect(a.getState().ledger).toEqual(b.getState().ledger);
    expect(outstanding(a.getState().ledger, meOf(b))).toBe(2);
  });

  it('the server rejects a vote after the deadline; it disappears locally and is reported', async () => {
    const server = new FakeServer(clock.now);
    const a = device(server, 'userA').store;
    await a.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, mode: 'shared' });
    await flush();
    const code = a.getState().inviteCode!;
    const [b, c] = [device(server, 'userB'), device(server, 'userC')];
    await b.store.getState().joinByInvite(code);
    await b.store.getState().registerSelf('민수', { color: '#0f0' });
    await c.store.getState().joinByInvite(code);
    await c.store.getState().registerSelf('하나', { color: '#00f' });
    await flush(40);

    const rec = await a.getState().dispatch({ type: 'RecordArrival', playerId: meOf(b.store), arrivedAt: '09:30' });
    const targetId = rec.ok ? rec.value[0]!.id : (undefined as never);
    const prop = await a.getState().dispatch({ type: 'ProposeWaive', targetId, reason: '폭설' });
    const proposalId = prop.ok ? prop.value[0]!.id : (undefined as never);
    await flush(40);

    // C goes offline, votes just before the deadline locally, reconnects after it.
    c.net.online = false;
    clockMs += 71 * 3_600_000;
    await c.store.getState().dispatch({ type: 'VoteWaive', proposalId, vote: 'approve' });
    expect(c.store.getState().ledger.proposals[proposalId]?.status).toBe('approved');
    clockMs += 2 * 3_600_000;
    c.net.online = true;
    await flush(80);

    expect(c.store.getState().rejections.map((r) => r.reason)).toEqual(['proposal_expired']);
    expect(c.store.getState().ledger.proposals[proposalId]?.status).toBe('open');
    expect(outstanding(c.store.getState().ledger, meOf(b.store))).toBe(1);
  });

  it('a group created offline is registered once online, then its events are pushed', async () => {
    const server = new FakeServer(clock.now);
    const net = makeNet(false);
    const { store } = device(server, 'userA', net);
    await store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, mode: 'shared' });
    await store.getState().dispatch({ type: 'AddPlayer', id: asPlayerId('x'), name: '민수', appearance: { color: '#0f0' } });
    await flush();
    expect(server.groups.size).toBe(0);
    net.online = true;
    await flush(80);
    expect(server.groups.size).toBe(1);
    expect(server.events).toHaveLength(3);
    expect(store.getState().inviteCode).toBe('INV1');
  });

  it('retried pushes are idempotent', async () => {
    const { a, b } = await twoDevices();
    const before = a.getState().events.length;
    // Push the already-confirmed events again: same seqs, nothing duplicated.
    const results = await a.remote!.push(a.getState().events);
    expect(results.every((r) => !r.error)).toBe(true);
    await a.getState().confirm(results);
    expect(a.getState().events).toHaveLength(before);
    expect(b.getState().events).toHaveLength(before);
  });

  it('local-only stores never sync', async () => {
    const store = createLedgerStore({ ...createMemoryStores(), clock });
    stops.push(startSync(store));
    await store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, mode: 'shared' });
    expect(store.getState().sync).toBe('local');
  });
});

describe('invite links and accounts', () => {
  it('opening an invite link watches read-only, live, until registering', async () => {
    const { server, a, b, code } = await twoDevices();
    const v = device(server, 'userV');
    await v.store.getState().openInvite(code);
    await flush();
    const viewer = v.store.getState();
    expect(viewer.me).toBeNull();
    expect(viewer.ledger.playerOrder).toHaveLength(2);
    expect(viewer.sync).toBe('synced');
    expect((await viewer.dispatch({ type: 'RecordArrival', playerId: meOf(b), arrivedAt: '09:30' })).ok).toBe(false);

    await a.getState().dispatch({ type: 'RecordArrival', playerId: meOf(b), arrivedAt: '09:30' });
    await flush(40);
    expect(outstanding(v.store.getState().ledger, meOf(b))).toBe(1);

    await v.store.getState().registerSelf('하나', { color: '#00f' });
    await flush(40);
    expect(v.store.getState().me).not.toBeNull();
    expect(a.getState().ledger.players[meOf(v.store)]?.name).toBe('하나');
  });

  it('a member opening the link again continues as their player', async () => {
    const { server, b, code } = await twoDevices();
    server.signedIn.add('userB');
    const again = device(server, 'userB');
    await again.store.getState().openInvite(code);
    expect(again.store.getState().me).toBe(meOf(b));
  });

  it('an anonymous session only watches, even where it holds a player', async () => {
    const { server, b, code } = await twoDevices();
    const again = device(server, 'userB');
    await again.store.getState().openInvite(code);
    expect(again.store.getState().me).toBeNull();
    expect((await again.store.getState().dispatch({ type: 'RecordArrival', playerId: meOf(b), arrivedAt: '09:30' })).ok).toBe(false);
    // Same on start-up, for a device that joined before sign-in was required.
    await b.getState().init();
    expect(b.getState().me).toBeNull();
  });

  it('a signed-in account can take over a name held by an anonymous one, not by another signed-in one', async () => {
    const { server, b, code } = await twoDevices();
    const anon = device(server, 'userE');
    await anon.store.getState().openInvite(code);
    expect((await anon.store.getState().claims()).find((c) => c.playerId === meOf(b))).toEqual({ playerId: meOf(b), anonymous: true });
    await expect(anon.store.getState().claim(meOf(b))).rejects.toThrow(/player_taken/);

    server.signedIn.add('userD');
    const d = device(server, 'userD');
    await d.store.getState().openInvite(code);
    await d.store.getState().claim(meOf(b));
    expect(d.store.getState().me).toBe(meOf(b));
    expect(await d.store.getState().claims()).toContainEqual({ playerId: meOf(b), anonymous: false });

    server.signedIn.add('userF');
    const f = device(server, 'userF');
    await f.store.getState().openInvite(code);
    await expect(f.store.getState().claim(meOf(b))).rejects.toThrow(/player_taken/);
  });

  it('lists the account’s groups and switches between them', async () => {
    const { a } = await twoDevices();
    const me = meOf(a);
    await a.getState().closeGroup();
    expect(a.getState().groupId).toBeNull();
    const groups = await a.getState().myGroups();
    expect(groups).toHaveLength(1);
    await a.getState().openGroup(groups[0]!);
    expect(a.getState().me).toBe(me);
    expect(a.getState().inviteCode).toBe(groups[0]!.inviteCode);
  });
});

import { createLedgerStore, createMemoryStores, type Account, type LedgerStore, type RemoteSync } from '@coffee/app';
import { asPlayerId, type LedgerEvent } from '@coffee/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/AppShell';
import { LedgerProvider } from '../src/context';
import { SettingsSheet } from '../src/SettingsSheet';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

/** A shared group (지원 owner, 민수, 하나) as the server has it: 지원 is held by a signed-in account, 민수 by an anonymous one. */
async function serverLedger(): Promise<LedgerEvent[]> {
  let seq = 0;
  const local = createLedgerStore({ ...createMemoryStores(), newId: () => `id${++seq}` });
  await local.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, timeZone: 'Asia/Seoul' });
  await local.getState().dispatch({ type: 'AddPlayer', id: asPlayerId('B'), name: '민수', appearance: { color: '#0f0' } });
  await local.getState().dispatch({ type: 'AddPlayer', id: asPlayerId('C'), name: '하나', appearance: { color: '#00f' } });
  return local.getState().events.map((e, i) => ({ ...e, seq: i + 1, serverAt: e.at }));
}

async function viewerStore(account: Account = { id: 'viewer', anonymous: true }) {
  const events = await serverLedger();
  const groupId = events[0]!.groupId;
  const signIn = vi.fn(async () => {});
  const remote = {
    ensureSession: async () => {},
    viewGroup: async () => ({ groupId, member: false, playerId: null }),
    pull: async () => events,
    claimedPlayers: async () => [
      { playerId: events[0]!.actorId, anonymous: false },
      { playerId: asPlayerId('B'), anonymous: true },
    ],
    account: async () => account,
    signIn,
    subscribe: () => () => {},
  } as unknown as RemoteSync;
  const store: LedgerStore = createLedgerStore({ ...createMemoryStores(), remote });
  await store.getState().openInvite('code1234');
  store.setState({ status: 'ready' });
  return { store, signIn };
}

const renderApp = (store: LedgerStore) =>
  render(
    <LedgerProvider store={store}>
      <AppShell renderScene={() => null} />
    </LedgerProvider>,
  );

describe('opening an invite link', () => {
  it('asks who you are, showing every name — taken ones too', async () => {
    const { store, signIn } = await viewerStore();
    const user = userEvent.setup();
    renderApp(store);
    expect(screen.getByRole('heading', { name: '당신은 누구십니까?' })).toBeTruthy();
    expect((await screen.findByRole('button', { name: /지원 · 참여 중/ })).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /하나입니다/ })).toBeTruthy();
    // Not signed in: picking a name goes to Google first and is finished after the redirect.
    await user.click(screen.getByRole('button', { name: /민수입니다 \(되찾기\)/ }));
    expect(signIn).toHaveBeenCalledWith('google', location.href);
    expect(JSON.parse(sessionStorage.getItem('coffee-maker:pending-claim')!)).toMatchObject({ playerId: 'B' });
  });

  it('can be watched read-only, with sign-in floating over the scene', async () => {
    const { store, signIn } = await viewerStore();
    const user = userEvent.setup();
    renderApp(store);
    await user.click(screen.getByRole('button', { name: '👀 몰래 보기' }));
    expect(screen.getByRole('region', { name: '👀 몰래 보는 중' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /업보 청구/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Google로 로그인' }));
    expect(signIn).toHaveBeenCalled();
  });

  it('offers to take part once signed in', async () => {
    const { store } = await viewerStore({ id: 'g', anonymous: false, email: 'g@example.test' });
    const user = userEvent.setup();
    renderApp(store);
    await user.click(screen.getByRole('button', { name: '👀 몰래 보기' }));
    await user.click(screen.getByRole('button', { name: '참여하기' }));
    expect(screen.getByRole('heading', { name: '당신은 누구십니까?' })).toBeTruthy();
  });
});

describe('invite link', () => {
  it('shows a check next to the copy button after copying', async () => {
    const { store } = await viewerStore();
    store.setState({ me: asPlayerId('B'), sync: 'synced' });
    const user = userEvent.setup();
    render(
      <LedgerProvider store={store}>
        <SettingsSheet open onOpenChange={() => {}} />
      </LedgerProvider>,
    );
    expect(screen.queryByRole('img', { name: '초대 링크를 복사했습니다' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '링크 복사' }));
    expect(screen.getByRole('img', { name: '초대 링크를 복사했습니다' })).toBeTruthy();
  });
});

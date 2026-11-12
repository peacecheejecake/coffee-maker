import { createLedgerStore, createMemoryStores, type Account, type LedgerStore, type RemoteSync } from '@coffee/app';
import { asPlayerId, type LedgerEvent } from '@coffee/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/AppShell';
import { JoinScreen } from '../src/Claim';
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

const GOOGLE: Account = { id: 'g', anonymous: false, email: 'g@example.test' };

/** Opens the group through its invite link as `account`, which holds `playerId` there (none by default). */
async function viewerStore(account: Account = { id: 'viewer', anonymous: true }, playerId: string | null = null) {
  const events = await serverLedger();
  const groupId = events[0]!.groupId;
  const signIn = vi.fn(async () => {});
  const remote = {
    ensureSession: async () => {},
    viewGroup: async () => ({ groupId, member: playerId !== null, playerId }),
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

/** /join/:code as the app routes it: the join screen, then the app. */
async function openLink(store: LedgerStore) {
  const done = vi.fn();
  render(
    <LedgerProvider store={store}>
      <JoinScreen code="code1234" onDone={done} />
    </LedgerProvider>,
  );
  await waitFor(() => expect(done).toHaveBeenCalled());
  cleanup();
  renderApp(store);
}

describe('opening an invite link', () => {
  it('without signing in: watches read-only, with Google sign-in floating over the scene', async () => {
    const { store, signIn } = await viewerStore();
    const user = userEvent.setup();
    await openLink(store);
    expect(screen.getByRole('region', { name: '👀 몰래 보는 중' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '당신은 누구십니까?' })).toBeNull();
    expect(screen.queryByRole('button', { name: /업보 청구/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Google로 로그인' }));
    expect(signIn).toHaveBeenCalledWith('google', location.href);
  });

  it('an anonymous session that holds a player still only watches', async () => {
    const { store } = await viewerStore(undefined, 'B');
    await openLink(store);
    expect(store.getState().me).toBeNull();
    expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '공사 규정' })).toBeNull();
  });

  it('signed in but not a member: watches first, then picks a name — taken ones listed too', async () => {
    const { store } = await viewerStore(GOOGLE);
    const user = userEvent.setup();
    await openLink(store);
    await user.click(screen.getByRole('button', { name: '참여하기' }));
    expect(screen.getByRole('heading', { name: '당신은 누구십니까?' })).toBeTruthy();
    expect((await screen.findByRole('button', { name: /지원 · 참여 중/ })).hasAttribute('disabled')).toBe(true);
    // Held by an anonymous session: a signed-in account can take it back.
    expect(screen.getByRole('button', { name: /민수입니다 \(되찾기\)/ }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: /하나입니다/ })).toBeTruthy();
  });

  it('a signed-in member continues as their player', async () => {
    const { store } = await viewerStore(GOOGLE, 'B');
    await openLink(store);
    expect(store.getState().me).toBe('B');
    expect(screen.queryByRole('region', { name: '👀 몰래 보는 중' })).toBeNull();
    expect(screen.getByRole('button', { name: '공사 규정' })).toBeTruthy();
  });
});

describe('invite link', () => {
  it('shows a check inside the copy button after copying', async () => {
    const { store } = await viewerStore(GOOGLE, 'B');
    store.setState({ sync: 'synced' });
    const user = userEvent.setup();
    render(
      <LedgerProvider store={store}>
        <SettingsSheet open onOpenChange={() => {}} />
      </LedgerProvider>,
    );
    expect(screen.queryByRole('img', { name: '초대 링크를 복사했습니다' })).toBeNull();
    const copy = screen.getByRole('button', { name: '링크 복사' });
    await user.click(copy);
    // The check sits inside the button.
    expect(within(copy).getByRole('img', { name: '초대 링크를 복사했습니다' })).toBeTruthy();
  });
});

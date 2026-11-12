import { createLedgerStore, createMemoryStores, type LedgerStore } from '@coffee/app';
import { asPlayerId } from '@coffee/core';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckInButton } from '../src/Attendance';
import { LedgerProvider } from '../src/context';
import { RecordSheet } from '../src/RecordSheet';
import { lateSchedule, TierEditor } from '../src/SettingsSheet';
import { LedgerSheet } from '../src/LedgerSheet';
import { SpectateForm } from '../src/Motions';
import type { CupTier } from '@coffee/core';

afterEach(cleanup);

/** Store at 2026-10-23 09:40 Seoul with 지원 (owner) and 민수. */
async function makeStore(): Promise<LedgerStore> {
  let seq = 0;
  const store = createLedgerStore({
    ...createMemoryStores(),
    clock: { now: () => new Date('2026-10-23T00:40:00Z') },
    newId: () => `id${++seq}`,
  });
  await store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, mode: 'shared', timeZone: 'Asia/Seoul' });
  await store.getState().dispatch({ type: 'AddPlayer', id: asPlayerId('B'), name: '민수', appearance: { color: '#0f0' } });
  return store;
}

describe('RecordSheet', () => {
  it('previews from the domain rules and records', async () => {
    const store = await makeStore();
    const user = userEvent.setup();
    render(
      <LedgerProvider store={store}>
        <RecordSheet open onOpenChange={() => {}} initialPlayerId={asPlayerId('B')} onCorrectExisting={() => {}} />
      </LedgerProvider>,
    );
    const dialog = screen.getByRole('dialog');
    // Defaults to "now" (09:40 Seoul).
    expect(within(dialog).getByText('40분 지각 → ☕ 1잔')).toBeTruthy();

    const time = within(dialog).getByLabelText('도착 시각');
    await user.clear(time);
    await user.type(time, '09:01');
    expect(within(dialog).getByText('정시 출근 ✅')).toBeTruthy();

    await user.clear(time);
    await user.type(time, '09:15');
    await user.click(within(dialog).getByRole('button', { name: /^청구/ }));
    const [late] = Object.values(store.getState().ledger.lates);
    expect(late).toMatchObject({ playerId: 'B', arrivedAt: '09:15', minutesLate: 15, cups: 1 });
  });

  it('manual cup override and back-dating', async () => {
    const store = await makeStore();
    const user = userEvent.setup();
    render(
      <LedgerProvider store={store}>
        <RecordSheet open onOpenChange={() => {}} initialPlayerId={asPlayerId('B')} onCorrectExisting={() => {}} />
      </LedgerProvider>,
    );
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByText('자세히'));
    const date = within(dialog).getByLabelText('날짜');
    await user.clear(date);
    await user.type(date, '2026-10-20');
    await user.click(within(dialog).getByRole('checkbox', { name: '잔 수 직접 지정' }));
    await user.click(within(dialog).getByRole('button', { name: '잔 수 직접 지정 +' }));
    expect(within(dialog).getByText('40분 지각 → ☕ 2잔')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /^청구/ }));
    expect(Object.values(store.getState().ledger.lates)[0]).toMatchObject({ workDate: '2026-10-20', cups: 2, cupsOverridden: true });
  });
});

describe('LedgerSheet', () => {
  it('shows correction history as a diff', async () => {
    const store = await makeStore();
    const r = await store.getState().dispatch({ type: 'RecordArrival', playerId: asPlayerId('B'), arrivedAt: '09:30' });
    const id = r.ok ? r.value[0]!.id : (undefined as never);
    await store.getState().dispatch({ type: 'CorrectLate', targetId: id, changes: { arrivedAt: '09:05', cups: 2 }, reason: '확인' });
    const user = userEvent.setup();
    render(
      <LedgerProvider store={store}>
        <LedgerSheet playerId={asPlayerId('B')} onOpenChange={() => {}} onCorrect={() => {}} onOpenBallots={() => {}} />
      </LedgerProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: '민수의 업보 명세서' });
    expect(within(dialog).getByText('미상환 2잔 · 신용등급 A 성실 납부자')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /09:05 도착/ }));
    expect(within(dialog).getByText(/도착 시각 09:30→09:05 · ☕ 1→2 · 지원/)).toBeTruthy();
    expect(within(dialog).getByText(/확인/)).toBeTruthy();
    // Recorded by me within 10 minutes → retract offered.
    await user.click(within(dialog).getByRole('button', { name: '철회' }));
    await act(async () => {});
    expect(store.getState().ledger.lates[id]?.status).toBe('retracted');
  });
});

describe('TierEditor', () => {
  function Harness({ initial }: { initial: CupTier[] }) {
    const [tiers, setTiers] = useState(initial);
    return (
      <LedgerProvider store={createLedgerStore(createMemoryStores())}>
        <TierEditor tiers={tiers} onChange={setTiers} />
        <output data-testid="json">{JSON.stringify(tiers)}</output>
      </LedgerProvider>
    );
  }

  it('adds, edits, sorts and removes tiers, keeping the open-ended last tier', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { upToMinutes: 15, cups: 1 },
          { upToMinutes: null, cups: 2 },
        ]}
      />,
    );
    const json = () => JSON.parse(screen.getByTestId('json').textContent!);
    await user.click(screen.getByRole('button', { name: '+ 구간 추가' }));
    expect(json()).toEqual([
      { upToMinutes: 15, cups: 1 },
      { upToMinutes: 30, cups: 2 },
      { upToMinutes: null, cups: 2 },
    ]);
    const second = screen.getAllByRole('spinbutton')[1]!;
    await user.clear(second);
    await user.type(second, '5');
    await user.tab(); // blur sorts
    expect(json().map((t: CupTier) => t.upToMinutes)).toEqual([5, 15, null]);
    await user.click(screen.getAllByRole('button', { name: '구간 삭제' })[0]!);
    expect(json()).toEqual([
      { upToMinutes: 15, cups: 1 },
      { upToMinutes: null, cups: 2 },
    ]);
  });
});

describe('attendance mode', () => {
  /** Attendance group adopted on Fri 10-23; the clock is moved by the test. */
  async function attendanceStore(now: { at: string }) {
    let seq = 0;
    const store = createLedgerStore({
      ...createMemoryStores(),
      clock: { now: () => new Date(now.at) },
      newId: () => `id${++seq}`,
    });
    await store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, timeZone: 'Asia/Seoul' });
    await store.getState().dispatch({ type: 'AddPlayer', id: asPlayerId('B'), name: '민수', appearance: { color: '#0f0' } });
    return store;
  }

  it('the check-in button explains why it is unavailable, then checks in late by the rules', async () => {
    const now = { at: '2026-10-23T00:40:00Z' };
    const store = await attendanceStore(now);
    const user = userEvent.setup();
    render(
      <LedgerProvider store={store}>
        <CheckInButton />
      </LedgerProvider>,
    );
    expect(screen.getByRole('button', { name: /규정 확정 대기/ }).hasAttribute('disabled')).toBe(true);
    await act(() => store.getState().dispatch({ type: 'AdoptRules', ruleset: store.getState().ledger.rulesets.at(-1)!.ruleset }));
    expect(screen.getByRole('button', { name: /부터 판정/ }).hasAttribute('disabled')).toBe(true);

    now.at = '2026-10-26T00:10:00Z'; // Mon 09:10 Seoul
    // The button reads the clock when it renders.
    cleanup();
    render(
      <LedgerProvider store={store}>
        <CheckInButton />
      </LedgerProvider>,
    );
    await user.click(screen.getByRole('button', { name: /출두 체크/ }));
    const [late] = Object.values(store.getState().ledger.lates);
    expect(late).toMatchObject({ origin: 'checkIn', arrivedAt: '09:10', cups: 1 });
    expect(screen.getByRole('button', { name: /출두 완료/ }).hasAttribute('disabled')).toBe(true);
  });

  it('adjusts cups from the ledger sheet without a vote while alone', async () => {
    const store = await attendanceStore({ at: '2026-10-23T00:40:00Z' });
    const user = userEvent.setup();
    render(
      <LedgerProvider store={store}>
        <LedgerSheet playerId={asPlayerId('B')} proposeFor={null} onOpenChange={() => {}} onCorrect={() => {}} onOpenBallots={() => {}} />
      </LedgerProvider>,
    );
    // B never used the app, so 지원 is alone: no "발의" wording, and it passes at once.
    await user.click(screen.getByRole('button', { name: '업보 수정' }));
    await user.type(screen.getByLabelText('사유'), '회식 지각');
    await user.click(screen.getByRole('button', { name: '수정' }));
    expect(Object.values(store.getState().ledger.motions)[0]?.status).toBe('approved');
    expect(store.getState().ledger.towers[asPlayerId('B')]?.cups).toHaveLength(1);
  });
});

describe('spectator motion', () => {
  it('turns picked players into spectators, then back, and keeps spectators from checking in', async () => {
    let seq = 0;
    const store = createLedgerStore({
      ...createMemoryStores(),
      clock: { now: () => new Date('2026-10-26T00:10:00Z') },
      newId: () => `id${++seq}`,
    });
    await store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, timeZone: 'Asia/Seoul' });
    await store.getState().dispatch({ type: 'AddPlayer', id: asPlayerId('B'), name: '민수', appearance: { color: '#0f0' } });
    const user = userEvent.setup();
    const B = asPlayerId('B');

    render(
      <LedgerProvider store={store}>
        <SpectateForm spectator />
      </LedgerProvider>,
    );
    // The last participant cannot be picked away; 민수 never used the app, so 지원 alone decides.
    await user.click(screen.getByRole('button', { name: '지원' }));
    expect(screen.getByRole('alert').textContent).toContain('최소 한 명');
    expect(screen.getByRole('button', { name: '관전자로 전환' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: '지원' }));
    await user.click(screen.getByRole('button', { name: '민수' }));
    await user.click(screen.getByRole('button', { name: '관전자로 전환' }));
    expect(store.getState().ledger.spectators[B]).toBe(true);

    cleanup();
    render(
      <LedgerProvider store={store}>
        <SpectateForm spectator={false} />
      </LedgerProvider>,
    );
    await user.click(screen.getByRole('button', { name: '민수' }));
    await user.click(screen.getByRole('button', { name: '복귀' }));
    expect(store.getState().ledger.spectators[B]).toBeUndefined();
  });
});

describe('rule preview', () => {
  it('lists when each cup count starts, after the grace minutes', async () => {
    const store = await makeStore();
    const rs = store.getState().ledger.rulesets.at(-1)!.ruleset;
    const base = { ...rs, defaultStartTime: '08:30', graceMinutes: 1 };
    expect(lateSchedule({ ...base, cupRule: { mode: 'fixed', cups: 1 } })).toEqual([{ at: '08:32', cups: 1 }]);
    const tiers = [
      { upToMinutes: 15, cups: 1 },
      { upToMinutes: null, cups: 2 },
    ];
    expect(lateSchedule({ ...base, cupRule: { mode: 'tiered', tiers } })).toEqual([
      { at: '08:32', cups: 1 },
      { at: '08:46', cups: 2 },
    ]);
  });
});

import { createLedgerStore, createMemoryStores, type LedgerStore } from '@coffee/app';
import { asPlayerId } from '@coffee/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LedgerProvider } from '../src/context';
import { HistorySheet } from '../src/HistorySheet';
import { SettingsSheet } from '../src/SettingsSheet';

afterEach(cleanup);

const B = asPlayerId('B');

/** 2026-10-23 09:40 Seoul: 지원 (owner) and 민수, in the given mode. */
async function makeStore(mode: 'shared' | 'attendance' = 'shared'): Promise<LedgerStore> {
  let seq = 0;
  const store = createLedgerStore({
    ...createMemoryStores(),
    clock: { now: () => new Date('2026-10-23T00:40:00Z') },
    newId: () => `id${++seq}`,
  });
  await store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, mode, timeZone: 'Asia/Seoul' });
  await store.getState().dispatch({ type: 'AddPlayer', id: B, name: '민수', appearance: { color: '#0f0' } });
  return store;
}

const items = () => within(screen.getByRole('list', { name: '저승 이력부' })).getAllByRole('listitem').map((li) => li.textContent);

describe('history', () => {
  it('lists what happened newest first and narrows by several filters at once', async () => {
    const store = await makeStore();
    const { dispatch } = store.getState();
    await dispatch({ type: 'RecordArrival', playerId: B, workDate: '2026-10-23', arrivedAt: '09:30', allowDuplicate: false });
    const late = Object.keys(store.getState().ledger.lates)[0]!;
    await dispatch({ type: 'ProposeWaive', targetId: late as never, reason: '지하철 고장' });
    await dispatch({ type: 'SetHoliday', date: '2026-10-30', name: '창립기념일', off: true });
    const user = userEvent.setup();
    render(
      <LedgerProvider store={store}>
        <HistorySheet open onOpenChange={() => {}} />
      </LedgerProvider>,
    );

    const all = items();
    expect(all[0]).toContain('10. 30. (금) 휴무일 지정: 창립기념일');
    // Alone with a member who never used the app, the waiver passes at once; its row says how it ended.
    expect(all[1]).toMatch(/민수의 탕감 심의를 발의했습니다.*가결/);
    expect(all[2]).toContain('민수에게 업보 1잔을 청구했습니다');
    expect(all.at(-1)).toContain('관할 구역에 합류했습니다');

    // Filters add up: 탕감 + 일정 변경 shows both and nothing else.
    await user.click(screen.getByRole('button', { name: '탕감' }));
    await user.click(screen.getByRole('button', { name: '일정 변경' }));
    expect(items()).toHaveLength(2);
    expect(screen.getByRole('button', { name: '전체' }).getAttribute('aria-pressed')).toBe('false');

    await user.click(screen.getByRole('button', { name: '전체' }));
    expect(items()).toHaveLength(all.length);
  });

  it('shows a withdrawn review as its own line, under the same filters as the proposal', async () => {
    const store = await makeStore();
    const { dispatch, setMe } = store.getState();
    const A = store.getState().me!;
    // 민수 has used the app, so the waiver waits for their vote instead of passing at once.
    await setMe(B);
    await dispatch({ type: 'RecordArrival', playerId: A, workDate: '2026-10-23', arrivedAt: '09:30', allowDuplicate: false });
    await setMe(A);
    const late = Object.keys(store.getState().ledger.lates)[0]!;
    await dispatch({ type: 'ProposeWaive', targetId: late as never, reason: '지하철 고장' });
    const pid = Object.keys(store.getState().ledger.proposals)[0]!;
    await dispatch({ type: 'WithdrawWaive', proposalId: pid as never });
    const user = userEvent.setup();
    render(
      <LedgerProvider store={store}>
        <HistorySheet open onOpenChange={() => {}} />
      </LedgerProvider>,
    );

    await user.click(screen.getByRole('button', { name: '탕감' }));
    const [withdrawn, proposed] = items();
    expect(withdrawn).toContain('지원님이 지원의 탕감 심의를 철회했습니다');
    expect(proposed).toMatch(/탕감 심의를 발의했습니다.*철회/);
  });
});

describe('player roster', () => {
  it('opens the add form from its own row and lists spectators apart', async () => {
    const store = await makeStore('attendance');
    await store.getState().dispatch({ type: 'ProposeMotion', motion: { kind: 'spectate', playerIds: [B], spectator: true } });
    const user = userEvent.setup();
    render(
      <LedgerProvider store={store}>
        <SettingsSheet open onOpenChange={() => {}} />
      </LedgerProvider>,
    );

    // No separate color column: the dot is the color input.
    expect(screen.queryByText('색')).toBeNull();
    const spectators = screen.getByRole('group', { name: '관전자 1' });
    expect(within(spectators).getByDisplayValue('민수')).toBeTruthy();

    expect(screen.queryByPlaceholderText('이름')).toBeNull();
    await user.click(screen.getByRole('button', { name: '+ 채무자 추가' }));
    await user.type(screen.getByPlaceholderText('이름'), '하나');
    await user.click(screen.getByRole('button', { name: '추가' }));
    const added = Object.values(store.getState().ledger.players).find((p) => p?.name === '하나');
    expect(added).toBeTruthy();
    // A new member joins as a participant, above the spectator area.
    expect(within(spectators).queryByDisplayValue('하나')).toBeNull();
  });
});

import { createFakeGeolocation, createLedgerStore, createMemoryStores, type LedgerStore } from '@coffee/app';
import type { Workplace } from '@coffee/core';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckInButton, useWorkplaceWatch } from '../src/Attendance';
import { LedgerProvider } from '../src/context';
import { SettingsSheet } from '../src/SettingsSheet';
import { Toasts } from '../src/Toasts';
import type { WorkplaceMapProps } from '../src/WorkplaceMap';
import { WorkplaceSheet } from '../src/WorkplaceSheet';

// jsdom cannot run Leaflet; the stand-in shows the center and taps a fixed spot.
vi.mock('../src/WorkplaceMap', () => ({
  WorkplaceMap: ({ center, onPick, label }: WorkplaceMapProps) => (
    <button type="button" aria-label={label} onClick={() => onPick({ lat: 37.5, lng: 127.0000004 })}>
      {center ? `${center.lat},${center.lng}` : 'none'}
    </button>
  ),
}));

afterEach(cleanup);

const OFFICE: Workplace = { lat: 37.5665, lng: 126.978, radiusMeters: 150, label: '본사' };
const INSIDE = { ok: true as const, fix: { lat: 37.5666, lng: 126.978, accuracyMeters: 15 } };
const AWAY = { ok: true as const, fix: { lat: 37.581, lng: 126.978, accuracyMeters: 15 } };

/** Solo attendance group (owner 지원); with `workplace`, adopted on Fri 10-23 and the clock on Mon 10-26 09:05 Seoul. */
async function setup({ workplace, adopt = true }: { workplace?: Workplace; adopt?: boolean } = {}) {
  const now = { at: Date.parse('2026-10-23T00:05:00Z') };
  let seq = 0;
  const geo = createFakeGeolocation(INSIDE);
  const store = createLedgerStore({
    ...createMemoryStores(),
    geolocation: geo,
    clock: { now: () => new Date(now.at) },
    newId: () => `id${++seq}`,
  });
  await store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, timeZone: 'Asia/Seoul' });
  if (adopt) {
    const ruleset = { ...store.getState().ledger.rulesets.at(-1)!.ruleset, ...(workplace && { workplace }) };
    await store.getState().dispatch({ type: 'AdoptRules', ruleset });
    now.at += 3 * 86_400_000;
  }
  return { store, geo };
}

const renderWith = (store: LedgerStore, ui: React.ReactNode) => render(<LedgerProvider store={store}>{ui}</LedgerProvider>);

describe('workplace picker', () => {
  it('opens on the current position, then moves by search and by tapping the map', async () => {
    const { store } = await setup({ adopt: false });
    const onApply = vi.fn();
    const search = vi.fn(async () => [{ name: '서울역', lat: 37.5547, lng: 126.9707 }]);
    const user = userEvent.setup();
    renderWith(store, <WorkplaceSheet open onOpenChange={() => {}} value={undefined} onApply={onApply} search={search} />);
    const dialog = screen.getByRole('dialog', { name: '출두 구역 설정' });
    const map = await within(dialog).findByRole('button', { name: '구역 지도' });
    await waitFor(() => expect(map.textContent).toBe('37.5666,126.978'));

    await user.type(within(dialog).getByRole('searchbox', { name: '장소 검색' }), '서울역');
    await user.click(within(dialog).getByRole('button', { name: '장소 검색' }));
    expect(search).toHaveBeenCalledWith('서울역');
    await user.click(await within(dialog).findByRole('button', { name: '서울역' }));
    expect(map.textContent).toBe('37.5547,126.9707');

    // Taps are rounded to ~10 cm.
    await user.click(map);
    expect(map.textContent).toBe('37.5,127');
    await user.click(within(dialog).getByRole('button', { name: '반경 (m) +' }));
    await user.type(within(dialog).getByLabelText('이름 (선택)'), '  별관 ');
    await user.click(within(dialog).getByRole('button', { name: '이 구역으로' }));
    expect(onApply).toHaveBeenCalledWith({ lat: 37.5, lng: 127, radiusMeters: 200, label: '별관' });
  });

  it('when the position is unavailable it says so and waits for a pick', async () => {
    const { store, geo } = await setup({ adopt: false });
    geo.next = { ok: false, reason: 'denied' };
    renderWith(store, <WorkplaceSheet open onOpenChange={() => {}} value={undefined} onApply={() => {}} />);
    expect(await screen.findByText(/현재 위치를 가져올 수 없습니다/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '이 구역으로' }).hasAttribute('disabled')).toBe(true);
    // The "current location" button tries again.
    geo.next = INSIDE;
    await userEvent.setup().click(screen.getByRole('button', { name: /현재 위치/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '이 구역으로' }).hasAttribute('disabled')).toBe(false));
  });

  it('is part of the rules: the owner adopts it with them', async () => {
    const { store } = await setup({ adopt: false });
    const user = userEvent.setup();
    renderWith(store, <SettingsSheet open onOpenChange={() => {}} />);
    const rules = screen.getByRole('region', { name: '첫 규정 확정' });
    expect(within(rules).getByText(/어디서나 출두 체크/)).toBeTruthy();
    await user.click(within(rules).getByRole('button', { name: '구역 설정' }));
    const picker = screen.getByRole('dialog', { name: '출두 구역 설정' });
    await waitFor(() => expect(within(picker).getByRole('button', { name: '구역 지도' }).textContent).not.toBe('none'));
    await user.click(within(picker).getByRole('button', { name: '이 구역으로' }));
    expect(within(rules).getByText(/지정한 위치 · 반경 150m/)).toBeTruthy();

    await user.click(within(rules).getByRole('button', { name: '이 규정으로 확정' }));
    await user.click(within(rules).getAllByRole('button', { name: '이 규정으로 확정' }).at(-1)!);
    expect(store.getState().ledger.rulesets.at(-1)?.ruleset.workplace).toEqual({ lat: 37.5666, lng: 126.978, radiusMeters: 150 });
  });
});

describe('check-in inside the workplace', () => {
  function Watched() {
    useWorkplaceWatch();
    return (
      <>
        <CheckInButton />
        <Toasts />
      </>
    );
  }

  it('is disabled outside, with the distance, until a new reading is inside', async () => {
    const { store, geo } = await setup({ workplace: OFFICE });
    geo.next = AWAY;
    const user = userEvent.setup();
    renderWith(store, <Watched />);
    const button = await screen.findByRole('button', { name: /출두 구역 밖 \(1\.6km\)/ });
    expect(button.hasAttribute('disabled')).toBe(true);

    geo.next = INSIDE;
    await user.click(screen.getByRole('button', { name: '위치 다시 확인' }));
    await user.click(await screen.findByRole('button', { name: /출두 체크/ }));
    expect(await screen.findByRole('button', { name: /출두 완료/ })).toBeTruthy();
    expect(Object.values(store.getState().ledger.lates)[0]).toMatchObject({ origin: 'checkIn', arrivedAt: '09:05' });
  });

  it('explains a refused permission instead of checking in', async () => {
    const { store, geo } = await setup({ workplace: OFFICE });
    geo.next = { ok: false, reason: 'denied' };
    renderWith(store, <Watched />);
    expect((await screen.findByRole('button', { name: /위치 권한이 필요합니다/ })).hasAttribute('disabled')).toBe(true);
  });

  it('checks in by itself when opened inside, if this device opted in', async () => {
    const { store } = await setup({ workplace: OFFICE });
    await store.getState().setAutoCheckIn(true);
    renderWith(store, <Watched />);
    expect(await screen.findByText('출두 구역 도착 — 자동 출두, 5분 늦어 업보 1잔')).toBeTruthy();
    expect(store.getState().ledger.attendance.days[`${store.getState().me}|2026-10-26`]).toBe('checkIn');
  });

  it('auto check-in can be switched on in the device settings once the rules set a workplace', async () => {
    const { store } = await setup({ workplace: OFFICE });
    const user = userEvent.setup();
    renderWith(store, <SettingsSheet open onOpenChange={() => {}} />);
    const auto = screen.getByRole('radiogroup', { name: '자동 출두 체크' });
    // The field's <label> also names the first option, so it is found by position.
    const on = within(auto).getAllByRole('radio')[0]!;
    expect(on.textContent).toBe('켜기');
    await user.click(on);
    await act(async () => {});
    expect(store.getState().autoCheckIn).toBe(true);
    expect(on.getAttribute('aria-checked')).toBe('true');
  });
});

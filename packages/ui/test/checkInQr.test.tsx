import { createFakeGeolocation, createLedgerStore, createMemoryStores, type LedgerStore } from '@coffee/app';
import { checkInQrFor, DEFAULT_RULESET, type Workplace } from '@coffee/core';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckInButton, useCheckInLink } from '../src/Attendance';
import { LedgerProvider } from '../src/context';
import { motionTitle } from '../src/Motions';
import { AccountSheet, SettingsSheet } from '../src/SettingsSheet';
import { Toasts } from '../src/Toasts';
import { createTranslator } from '@coffee/theme';

const CODE = 'ABCDEFGHJKLMNPQRSTUV';
const OTHER = 'ZZZZZZZZZZZZZZZZZZZZ';

// jsdom has no camera: the stand-in "scans" whichever code its buttons name.
vi.mock('../src/QrScanner', () => ({
  QrScannerSheet: ({ open, onCode }: { open: boolean; onCode: (code: string) => void }) =>
    open ? (
      <div role="dialog" aria-label="scanner">
        <button type="button" onClick={() => onCode(CODE)}>
          stub:scan
        </button>
        <button type="button" onClick={() => onCode(OTHER)}>
          stub:scan-other
        </button>
      </div>
    ) : null,
}));

// jsdom has no canvas either; the printable PNG is simply not offered.
HTMLCanvasElement.prototype.getContext = () => null;

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
});

const OFFICE: Workplace = { lat: 37.5665, lng: 126.978, radiusMeters: 150 };
const INSIDE = { ok: true as const, fix: { lat: 37.5666, lng: 126.978, accuracyMeters: 15 } };

/** Solo attendance group (owner 지원); with `qr`, the rules ask for CODE. Adopted Fri 10-23, clock Mon 10-26 09:05. */
async function setup({ qr = true, workplace, adopt = true }: { qr?: boolean; workplace?: Workplace; adopt?: boolean } = {}) {
  const now = { at: Date.parse('2026-10-23T00:05:00Z') };
  let seq = 0;
  const store = createLedgerStore({
    ...createMemoryStores(),
    geolocation: createFakeGeolocation(INSIDE),
    clock: { now: () => new Date(now.at) },
    newId: () => `id${++seq}`,
  });
  await store.getState().createGroup({ ownerName: '지원', appearance: { color: '#f00' }, timeZone: 'Asia/Seoul' });
  if (adopt) {
    const base = store.getState().ledger.rulesets.at(-1)!.ruleset;
    const ruleset = { ...base, ...(qr && { checkInQr: checkInQrFor(CODE) }), ...(workplace && { workplace }) };
    await store.getState().dispatch({ type: 'AdoptRules', ruleset });
    now.at += 3 * 86_400_000;
  }
  return store;
}

const renderWith = (store: LedgerStore, ui: React.ReactNode) => render(<LedgerProvider store={store}>{ui}</LedgerProvider>);
const checkedIn = (store: LedgerStore) => store.getState().ledger.attendance.days[`${store.getState().me}|2026-10-26`];

describe('issuing the check-in QR', () => {
  it('is part of the rules: issuing shows the QR once, and only its hash is adopted', async () => {
    const store = await setup({ adopt: false });
    const user = userEvent.setup();
    renderWith(store, <SettingsSheet open onOpenChange={() => {}} />);
    const rules = screen.getByRole('region', { name: '첫 규정 확정' });
    const field = within(rules).getByRole('group', { name: '출두 QR' });
    expect(within(field).getByText(/사용 안 함/)).toBeTruthy();

    await user.click(within(field).getByRole('button', { name: 'QR 발급' }));
    const sheet = screen.getByRole('dialog', { name: '출두 QR 발급' });
    expect(await within(sheet).findByRole('img', { name: '출두 QR' })).toBeTruthy();
    await user.click(within(sheet).getAllByRole('button', { name: '닫기' }).at(-1)!);
    expect(within(field).getByText(/사용 중/)).toBeTruthy();
    expect(within(field).getByRole('button', { name: '발급한 QR 보기' })).toBeTruthy();

    await user.click(within(rules).getByRole('button', { name: '이 규정으로 확정' }));
    await user.click(within(rules).getAllByRole('button', { name: '이 규정으로 확정' }).at(-1)!);
    expect(store.getState().ledger.rulesets.at(-1)?.ruleset.checkInQr?.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('can be turned off again before it is adopted', async () => {
    const store = await setup({ adopt: false });
    const user = userEvent.setup();
    renderWith(store, <SettingsSheet open onOpenChange={() => {}} />);
    const field = screen.getByRole('group', { name: '출두 QR' });
    await user.click(within(field).getByRole('button', { name: 'QR 발급' }));
    await user.click(within(screen.getByRole('dialog', { name: '출두 QR 발급' })).getAllByRole('button', { name: '닫기' }).at(-1)!);
    await user.click(within(field).getByRole('button', { name: 'QR 끄기' }));
    expect(within(field).getByText(/사용 안 함/)).toBeTruthy();
    expect(within(field).queryByRole('button', { name: '발급한 QR 보기' })).toBeNull();
  });

  it('motions mention the QR', () => {
    const t = createTranslator('underworld');
    const ruleset = { ...DEFAULT_RULESET, checkInQr: checkInQrFor(CODE) };
    expect(motionTitle(t, {} as never, { kind: 'ruleset', ruleset })).toContain('🔳QR');
  });
});

describe('checking in with the QR', () => {
  const Shell = () => (
    <>
      <CheckInButton />
      <Toasts />
    </>
  );

  it('the button opens the scanner, and the right code checks in', async () => {
    const store = await setup();
    const user = userEvent.setup();
    renderWith(store, <Shell />);
    await user.click(screen.getByRole('button', { name: /QR 찍고 출두/ }));
    await user.click(screen.getByRole('button', { name: 'stub:scan' }));
    expect(await screen.findByRole('button', { name: /출두 완료/ })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'scanner' })).toBeNull();
    expect(checkedIn(store)).toBe('checkIn');
  });

  it('another code is refused with a reason', async () => {
    const store = await setup();
    const user = userEvent.setup();
    renderWith(store, <Shell />);
    await user.click(screen.getByRole('button', { name: /QR 찍고 출두/ }));
    await user.click(screen.getByRole('button', { name: 'stub:scan-other' }));
    expect(await screen.findByText(/이 공사의 출두 QR이 아닙니다/)).toBeTruthy();
    expect(checkedIn(store)).toBeUndefined();
  });

  it('no auto check-in setting while the QR is required', async () => {
    const store = await setup({ workplace: OFFICE });
    renderWith(store, <AccountSheet open onOpenChange={() => {}} />);
    expect(screen.queryByRole('radiogroup', { name: '자동 출두 체크' })).toBeNull();
  });

  it('a QR opened with the phone camera checks in once the app is up, and leaves the address clean', async () => {
    const store = await setup();
    history.replaceState(null, '', `/?checkin=${CODE}`);
    function Linked() {
      useCheckInLink();
      return <Toasts />;
    }
    renderWith(store, <Linked />);
    await act(async () => {});
    await waitFor(() => expect(checkedIn(store)).toBe('checkIn'));
    expect(location.search).toBe('');
  });
});

describe('the printed QR', () => {
  it('decodes back to the code it was issued for', async () => {
    const { default: qrcode } = await import('qrcode-generator');
    const { default: jsQR } = await import('jsqr');
    const { checkInLink, parseCheckInQr } = await import('@coffee/core');
    const qr = qrcode(0, 'M');
    qr.addData(checkInLink('https://coffee-maker-wheat.vercel.app', CODE));
    qr.make();
    const n = qr.getModuleCount();
    const cell = 4;
    const size = (n + 8) * cell;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const r = Math.floor(y / cell) - 4;
        const c = Math.floor(x / cell) - 4;
        if (r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c)) data.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
      }
    }
    const hit = jsQR(data, size, size);
    expect(hit && parseCheckInQr(hit.data)).toBe(CODE);
  });
});

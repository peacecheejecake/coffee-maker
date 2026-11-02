import { beforeEach, describe, expect, it, vi } from 'vitest';

const browser = { open: vi.fn(async (_: unknown) => {}), close: vi.fn(async () => {}) };
vi.mock('@capacitor/browser', () => ({ Browser: browser }));

const { AUTH_CALLBACK_URL, handleAuthCallback, isAuthCallback, onNativeNotice, nativeNotice, openAuthPage } = await import('../src/native');

/** Minimal sessionStorage + location for the node test environment. */
function stubPage(pathname: string) {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  vi.stubGlobal('location', { href: `capacitor://localhost${pathname}`, pathname, search: '' });
  return data;
}

const deps = () => ({
  complete: vi.fn(async (_: string) => {}),
  closeBrowser: vi.fn(async () => {}),
  refreshAccount: vi.fn(async () => {}),
  navigate: vi.fn((_: string) => {}),
  notify: vi.fn((_: string) => {}),
});

beforeEach(() => vi.clearAllMocks());

describe('native Google sign-in', () => {
  it('opens the sign-in page in the in-app browser and remembers where it started', async () => {
    const data = stubPage('/');
    await openAuthPage('https://sb.example/authorize', 'capacitor://localhost/join/ABC');
    expect(browser.open).toHaveBeenCalledWith({ url: 'https://sb.example/authorize' });
    expect(data.get('coffee-maker:auth-return')).toBe('capacitor://localhost/join/ABC');
  });

  it('recognises only the auth callback deep link', () => {
    expect(AUTH_CALLBACK_URL).toBe('coffeemaker://auth-callback');
    expect(isAuthCallback('coffeemaker://auth-callback?code=1')).toBe(true);
    expect(isAuthCallback('coffeemaker://join/ABC')).toBe(false);
  });

  it('exchanges the code, closes the browser, refreshes the account and returns to the starting page', async () => {
    const data = stubPage('/');
    data.set('coffee-maker:auth-return', 'capacitor://localhost/join/ABC');
    const d = deps();
    await handleAuthCallback('coffeemaker://auth-callback?code=xyz', d);
    expect(d.complete).toHaveBeenCalledWith('coffeemaker://auth-callback?code=xyz');
    expect(d.closeBrowser).toHaveBeenCalled();
    expect(d.refreshAccount).toHaveBeenCalled();
    expect(d.refreshAccount.mock.invocationCallOrder[0]).toBeGreaterThan(d.complete.mock.invocationCallOrder[0]!);
    expect(d.navigate).toHaveBeenCalledWith('/join/ABC');
    expect(d.notify).not.toHaveBeenCalled();
    expect(data.has('coffee-maker:auth-return')).toBe(false);
  });

  it('stays put when already on the starting page', async () => {
    const data = stubPage('/');
    data.set('coffee-maker:auth-return', 'capacitor://localhost/');
    const d = deps();
    await handleAuthCallback('coffeemaker://auth-callback?code=xyz', d);
    expect(d.refreshAccount).toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it('reports a failed sign-in and does not touch the account', async () => {
    const data = stubPage('/');
    data.set('coffee-maker:auth-return', 'capacitor://localhost/join/ABC');
    const d = deps();
    d.complete.mockRejectedValueOnce(new Error('User cancelled'));
    await handleAuthCallback('coffeemaker://auth-callback?error_description=User+cancelled', d);
    expect(d.closeBrowser).toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith('User cancelled');
    expect(d.refreshAccount).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
    expect(data.has('coffee-maker:auth-return')).toBe(false);
  });

  it('holds notices until the UI listens', () => {
    nativeNotice('early');
    const seen: string[] = [];
    const stop = onNativeNotice((m) => seen.push(m));
    nativeNotice('late');
    stop();
    expect(seen).toEqual(['early', 'late']);
  });
});

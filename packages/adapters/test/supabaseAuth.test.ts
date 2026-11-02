import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  signInWithOAuth: vi.fn(async (_: unknown) => ({ data: { provider: 'google', url: 'https://sb.example/authorize?x=1' }, error: null })),
  exchangeCodeForSession: vi.fn(async (..._: unknown[]) => ({ data: {}, error: null as { message: string } | null })),
};
const createClient = vi.fn((..._: unknown[]) => ({ auth }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...args) }));

const { createSupabaseRemote } = await import('../src/supabase');

const native = () => ({ callbackUrl: 'coffeemaker://auth-callback', open: vi.fn(async () => {}) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Supabase OAuth', () => {
  it('uses the PKCE flow, keeping the caller’s other auth options', () => {
    createSupabaseRemote('https://sb.example', 'anon', { auth: { persistSession: false } });
    expect(createClient).toHaveBeenCalledWith('https://sb.example', 'anon', { auth: { flowType: 'pkce', persistSession: false } });
  });

  it('web: lets supabase-js redirect the page and come back to the starting page', async () => {
    const remote = createSupabaseRemote('https://sb.example', 'anon');
    await remote.signIn('google', 'https://app.example/join/ABC');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://app.example/join/ABC' } });
  });

  it('native: opens the sign-in page itself and returns through the custom scheme', async () => {
    const redirect = native();
    const remote = createSupabaseRemote('https://sb.example', 'anon', undefined, redirect);
    await remote.signIn('google', 'capacitor://localhost/');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'coffeemaker://auth-callback', skipBrowserRedirect: true },
    });
    expect(redirect.open).toHaveBeenCalledWith('https://sb.example/authorize?x=1', 'capacitor://localhost/');
  });

  it('reports OAuth start errors without opening anything', async () => {
    const redirect = native();
    auth.signInWithOAuth.mockResolvedValueOnce({ data: { provider: 'google', url: null }, error: { message: 'provider disabled' } } as never);
    const remote = createSupabaseRemote('https://sb.example', 'anon', undefined, redirect);
    await expect(remote.signIn('google', '/')).rejects.toThrow('provider disabled');
    expect(redirect.open).not.toHaveBeenCalled();
  });

  it('exchanges the code from the native callback', async () => {
    const remote = createSupabaseRemote('https://sb.example', 'anon', undefined, native());
    await remote.completeAuthRedirect('coffeemaker://auth-callback?code=abc');
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abc', undefined);
    await remote.completeAuthRedirect('coffeemaker://auth-callback?code=def&sb_flow_id=f1');
    expect(auth.exchangeCodeForSession).toHaveBeenLastCalledWith('def', { flowId: 'f1' });
  });

  it('surfaces callback errors (query or fragment) and failed exchanges', async () => {
    const remote = createSupabaseRemote('https://sb.example', 'anon', undefined, native());
    await expect(
      remote.completeAuthRedirect('coffeemaker://auth-callback?error=access_denied&error_description=User+cancelled'),
    ).rejects.toThrow('User cancelled');
    await expect(remote.completeAuthRedirect('coffeemaker://auth-callback#error_description=Bad%20state')).rejects.toThrow('Bad state');
    await expect(remote.completeAuthRedirect('coffeemaker://auth-callback')).rejects.toThrow(/No authorization code/);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    auth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { message: 'code verifier missing' } });
    await expect(remote.completeAuthRedirect('coffeemaker://auth-callback?code=x')).rejects.toThrow('code verifier missing');
  });
});

import type { AssetStore, GroupSummary, PushResult, RemoteStatus, RemoteSync } from '@coffee/app';
import { asGroupId, asPlayerId, upcast, type GroupId, type LedgerEvent, type RawEvent } from '@coffee/core';
import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';

interface EventRow {
  seq: number;
  server_at: string;
  body: Record<string, unknown>;
}

const PAGE = 1000;

/** The stored body plus the server's ordering and clock, upgraded to the current schema. */
const fromRow = (row: EventRow): LedgerEvent =>
  upcast({ ...row.body, seq: Number(row.seq), serverAt: new Date(row.server_at).toISOString() } as unknown as RawEvent);

/** Clients send only what they created; seq/serverAt are the server's to assign. */
const toBody = ({ seq: _seq, serverAt: _serverAt, ...rest }: LedgerEvent) => rest;

/**
 * How an OAuth sign-in leaves the app and comes back. Without one (the web), the page itself is redirected to
 * the provider and Supabase sends it back to `returnTo`. The native shell passes one: the provider page opens
 * in an in-app browser and Supabase returns through a custom-scheme deep link (`callbackUrl`), which the shell
 * hands to `completeAuthRedirect`.
 */
export interface AuthRedirect {
  /** Where Supabase sends the browser after sign-in, e.g. coffeemaker://auth-callback. Must be allow-listed. */
  callbackUrl: string;
  /** Opens the provider's sign-in page; `returnTo` is where the app should be once the callback is handled. */
  open(url: string, returnTo: string): Promise<void>;
}

/**
 * RemoteSync over Supabase (supabase/migrations): Google sign-in (anonymous sessions only watch), RPCs for
 * every write, RLS-guarded reads, and Realtime inserts for live updates.
 *
 * OAuth uses the PKCE flow: the redirect carries a one-time `?code=` (exchanged by supabase-js on page load
 * on the web, by `completeAuthRedirect` in the native shell) instead of tokens in the URL fragment.
 */
export function createSupabaseRemote(
  url: string,
  anonKey: string,
  options?: SupabaseClientOptions<'public'>,
  authRedirect?: AuthRedirect,
): RemoteSync & { client: SupabaseClient; completeAuthRedirect(callbackUrl: string): Promise<void> } {
  const client = createClient(url, anonKey, { ...options, auth: { flowType: 'pkce', ...options?.auth } });

  /** Native: open the provider page ourselves instead of letting supabase-js navigate the web view. */
  const leave = async (result: { data: { url: string | null }; error: { message: string } | null }, returnTo: string) => {
    if (result.error) throw new Error(result.error.message);
    if (!authRedirect) return;
    if (!result.data.url) throw new Error('No sign-in URL');
    await authRedirect.open(result.data.url, returnTo);
  };
  const redirectOptions = (returnTo: string) =>
    authRedirect ? { redirectTo: authRedirect.callbackUrl, skipBrowserRedirect: true } : { redirectTo: returnTo };

  const check = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    client,

    async ensureSession() {
      const { data } = await client.auth.getSession();
      if (data.session) return;
      check(await client.auth.signInAnonymously());
    },

    async createGroup({ groupId, playerId, name }) {
      const code = check(await client.rpc('create_group', { p_group_id: groupId, p_player_id: playerId, p_name: name }));
      return { inviteCode: String(code) };
    },

    async joinGroup(code) {
      const rows = check(await client.rpc('join_group', { p_code: code })) as { group_id: string; player_id: string | null }[];
      const row = rows[0];
      if (!row) throw new Error('invalid_invite');
      return { groupId: asGroupId(row.group_id), playerId: row.player_id ? asPlayerId(row.player_id) : null };
    },

    async viewGroup(code) {
      const rows = check(await client.rpc('view_group', { p_code: code })) as {
        group_id: string;
        member: boolean;
        player_id: string | null;
      }[];
      const row = rows[0];
      if (!row) throw new Error('invalid_invite');
      return {
        groupId: asGroupId(row.group_id),
        member: row.member,
        playerId: row.player_id ? asPlayerId(row.player_id) : null,
      };
    },

    async claimPlayer(groupId, playerId) {
      check(await client.rpc('claim_player', { p_group_id: groupId, p_player_id: playerId }));
    },

    async claimedPlayers(groupId) {
      const rows = check(await client.rpc('player_claims', { p_group_id: groupId })) as { player_id: string; anonymous: boolean }[];
      return (rows ?? []).map((r) => ({ playerId: asPlayerId(r.player_id), anonymous: r.anonymous }));
    },

    async myGroups() {
      const rows = check(await client.rpc('my_groups')) as {
        group_id: string;
        name: string;
        invite_code: string;
        role: GroupSummary['role'];
        player_id: string | null;
        player_name: string | null;
        members: number;
      }[];
      return (rows ?? []).map((r) => ({
        groupId: asGroupId(r.group_id),
        name: r.name,
        inviteCode: r.invite_code,
        role: r.role,
        playerId: r.player_id ? asPlayerId(r.player_id) : null,
        playerName: r.player_name,
        members: Number(r.members),
      }));
    },

    async inviteCode(groupId) {
      const row = check(await client.from('groups').select('invite_code').eq('id', groupId).maybeSingle());
      return (row as { invite_code: string } | null)?.invite_code ?? null;
    },

    async push(events): Promise<PushResult[]> {
      const rows = check(await client.rpc('append_events', { p_events: events.map(toBody) })) as {
        id: string;
        seq: number | null;
        server_at: string | null;
        error: string | null;
      }[];
      return rows.map((r) =>
        r.error || r.seq === null
          ? { id: r.id, error: r.error ?? 'unknown' }
          : { id: r.id, seq: Number(r.seq), serverAt: new Date(r.server_at!).toISOString() },
      );
    },

    async pull(groupId: GroupId, afterSeq: number) {
      const out: LedgerEvent[] = [];
      let after = afterSeq;
      for (;;) {
        const rows = check(
          await client
            .from('events')
            .select('seq, server_at, body')
            .eq('group_id', groupId)
            .gt('seq', after)
            .order('seq')
            .limit(PAGE),
        ) as EventRow[];
        out.push(...rows.map(fromRow));
        if (rows.length < PAGE) return out;
        after = Number(rows[rows.length - 1]!.seq);
      }
    },

    async savePushSubscription(groupId, sub) {
      // RPC: the endpoint may still belong to an earlier account on this browser.
      check(
        await client.rpc('save_push_subscription', {
          p_group_id: groupId,
          p_endpoint: sub.endpoint,
          p_p256dh: sub.keys.p256dh,
          p_auth: sub.keys.auth,
        }),
      );
    },

    async deletePushSubscription(endpoint) {
      check(await client.from('push_subscriptions').delete().eq('endpoint', endpoint));
    },

    async saveNativePushToken(groupId, token, platform) {
      check(await client.rpc('save_native_push_token', { p_group_id: groupId, p_token: token, p_platform: platform }));
    },

    async deleteNativePushToken(token) {
      check(await client.from('native_push_tokens').delete().eq('token', token));
    },

    async account() {
      // The stored session, not getUser(): this runs on start-up, possibly offline.
      const user = (await client.auth.getSession()).data.session?.user;
      if (!user) return null;
      return { id: user.id, anonymous: user.is_anonymous ?? false, ...(user.email && { email: user.email }) };
    },

    async signIn(provider, returnTo) {
      await leave(await client.auth.signInWithOAuth({ provider, options: redirectOptions(returnTo) }), returnTo);
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw new Error(error.message);
    },

    /** Finishes a native sign-in from the deep link Supabase redirected to (`?code=…` or `?error_description=…`). */
    async completeAuthRedirect(callbackUrl) {
      const parsed = new URL(callbackUrl);
      const params = new URLSearchParams(parsed.search);
      // Some errors come back in the fragment.
      new URLSearchParams(parsed.hash.slice(1)).forEach((v, k) => params.has(k) || params.set(k, v));
      const failure = params.get('error_description') ?? params.get('error');
      if (failure) throw new Error(failure);
      const code = params.get('code');
      if (!code) throw new Error('No authorization code in the sign-in callback');
      const flowId = params.get('sb_flow_id');
      const { error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      if (error) throw new Error(error.message);
    },

    subscribe(groupId, onEvents, onStatus: (s: RemoteStatus) => void) {
      onStatus('connecting');
      // SUBSCRIBED arrives before the database-side change feed is live; inserts in that gap would be missed.
      // Report "subscribed" (which makes the engine pull) once Realtime confirms the feed, or after a grace period.
      let ready = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const markReady = () => {
        if (ready) return;
        ready = true;
        clearTimeout(grace);
        onStatus('subscribed');
      };
      const channel = client
        .channel(`events:${groupId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'events', filter: `group_id=eq.${groupId}` },
          (payload) => onEvents([fromRow(payload.new as EventRow)]),
        )
        .on('system', {}, (msg: { extension?: string; status?: string }) => {
          if (msg.extension === 'postgres_changes' && msg.status === 'ok') markReady();
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') grace = setTimeout(markReady, 2_000);
          else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(grace);
            ready = false;
            onStatus('closed');
          }
        });
      return () => {
        clearTimeout(grace);
        void client.removeChannel(channel);
      };
    },
  };
}

/** Evidence photos in the private "evidence" bucket, under "<groupId>/<assetId>.webp" (members only). */
export function createSupabaseAssets(client: SupabaseClient): AssetStore {
  const path = (groupId: string, id: string) => `${groupId}/${id}.webp`;
  return {
    async put(groupId, blob) {
      const id = crypto.randomUUID();
      const { error } = await client.storage.from('evidence').upload(path(groupId, id), blob, {
        contentType: blob.type || 'image/webp',
      });
      if (error) throw new Error(error.message);
      return id;
    },
    async url(groupId, id) {
      const { data, error } = await client.storage.from('evidence').createSignedUrl(path(groupId, id), 3600);
      return error ? null : data.signedUrl;
    },
  };
}

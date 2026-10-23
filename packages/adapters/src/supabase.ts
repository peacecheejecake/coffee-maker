import type { AssetStore, PushResult, RemoteStatus, RemoteSync } from '@coffee/app';
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
 * RemoteSync over Supabase (supabase/migrations): anonymous auth, RPCs for every write, RLS-guarded reads,
 * and Realtime inserts for live updates.
 */
export function createSupabaseRemote(
  url: string,
  anonKey: string,
  options?: SupabaseClientOptions<'public'>,
): RemoteSync & { client: SupabaseClient } {
  const client = createClient(url, anonKey, options);

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

    async claimPlayer(groupId, playerId) {
      check(await client.rpc('claim_player', { p_group_id: groupId, p_player_id: playerId }));
    },

    async claimedPlayers(groupId) {
      const rows = check(await client.from('members').select('player_id').eq('group_id', groupId).not('player_id', 'is', null));
      return (rows ?? []).map((r: { player_id: string }) => asPlayerId(r.player_id));
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

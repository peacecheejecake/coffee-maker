// Edge Function: sends web push for ledger events (called by the events_notify trigger).
// Env: NOTIFY_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…);
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { playerNames, pushMessage, pushTargets, type EventRecord } from './message.ts';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  if (req.headers.get('x-notify-secret') !== Deno.env.get('NOTIFY_SECRET')) return new Response('forbidden', { status: 403 });
  const { record } = (await req.json()) as { record: EventRecord & { group_id: string } };
  const targets = pushTargets(record);
  if (targets.length === 0) return new Response('no targets');

  const { data: players } = await db
    .from('events')
    .select('type, body')
    .eq('group_id', record.group_id)
    .in('type', ['PlayerJoined', 'PlayerUpdated'])
    .order('seq');
  const names = playerNames(players ?? []);
  const message = pushMessage(record, (id) => names.get(id) ?? '누군가');
  if (!message) return new Response('nothing to say');

  const { data: members } = await db.from('members').select('user_id').eq('group_id', record.group_id).in('player_id', targets);
  const users = (members ?? []).map((m) => m.user_id);
  if (users.length === 0) return new Response('no devices');
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('group_id', record.group_id).in('user_id', users);

  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(message));
      } catch (e) {
        // Gone or invalid: the browser dropped the subscription.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    }),
  );
  return new Response(`sent ${subs?.length ?? 0}`);
});

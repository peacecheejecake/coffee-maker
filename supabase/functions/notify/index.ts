// Edge Function: sends push notifications for ledger events (called by the events_notify trigger).
// Web Push env: NOTIFY_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…).
// Native (optional): APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, APNS_BUNDLE_ID, APNS_PRODUCTION;
//                    FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { playerNames, pushMessage, pushTargets, type EventRecord, type PushMessage } from './message.ts';
import { apnsJwt, apnsRequest, fcmAccessToken, fcmRequest, isDeadToken, type ApnsConfig, type FcmConfig } from './native.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
// Local verification only: trust one extra CA (a mock push service with a self-signed certificate).
// Never set in production, where push services have public certificates.
const testCa = env('PUSH_TEST_CA').replace(/\\n/g, '\n');
const httpClient = testCa ? Deno.createHttpClient({ caCerts: [testCa] }) : undefined;

/** fetch that trusts the optional test CA (used for every outgoing push request). */
const clientFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, { ...init, ...(httpClient && { client: httpClient }) } as RequestInit)) as typeof fetch;

/**
 * web-push does the RFC 8291 encryption and VAPID signing; the request itself goes out with fetch
 * (Deno's native client) rather than web-push's Node https transport.
 */
async function deliverWebPush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) {
  const req = webpush.generateRequestDetails(sub, payload);
  const res = await clientFetch(req.endpoint, { method: req.method, headers: req.headers as Record<string, string>, body: req.body });
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${await res.text()}`), { statusCode: res.status });
}

const apns: ApnsConfig | null = env('APNS_KEY_ID')
  ? {
      keyId: env('APNS_KEY_ID'),
      teamId: env('APNS_TEAM_ID'),
      privateKey: env('APNS_PRIVATE_KEY').replace(/\\n/g, '\n'),
      bundleId: env('APNS_BUNDLE_ID') || 'app.coffeemaker.underworld',
      production: env('APNS_PRODUCTION') === 'true',
      ...(env('APNS_ORIGIN') && { origin: env('APNS_ORIGIN') }),
    }
  : null;
const fcm: FcmConfig | null = env('FCM_PROJECT_ID')
  ? {
      projectId: env('FCM_PROJECT_ID'),
      clientEmail: env('FCM_CLIENT_EMAIL'),
      privateKey: env('FCM_PRIVATE_KEY').replace(/\\n/g, '\n'),
      ...(env('FCM_ORIGIN') && { origin: env('FCM_ORIGIN') }),
      ...(env('FCM_TOKEN_URL') && { tokenUrl: env('FCM_TOKEN_URL') }),
    }
  : null;

/** Failure reasons from the current request, returned to the caller (visible in pg_net's response log). */
let failures: string[] = [];

async function sendWeb(groupId: string, users: string[], message: PushMessage): Promise<number> {
  const { data: subs, error } = await db.from('push_subscriptions').select('*').eq('group_id', groupId).in('user_id', users);
  if (error) failures.push(`web lookup ${error.message}`);
  let sent = 0;
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await deliverWebPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(message));
        sent++;
      } catch (e) {
        // Gone or invalid: the browser dropped the subscription.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        else failures.push(`web ${status ?? ''} ${(e as Error).message}`.slice(0, 200));
      }
    }),
  );
  return sent;
}

async function sendNative(groupId: string, users: string[], message: PushMessage): Promise<number> {
  if (!apns && !fcm) return 0;
  const { data: tokens } = await db.from('native_push_tokens').select('*').eq('group_id', groupId).in('user_id', users);
  if (!tokens?.length) return 0;
  const apnsToken = apns ? await apnsJwt(apns) : null;
  const fcmToken = fcm && tokens.some((t) => t.platform === 'android') ? await fcmAccessToken(fcm, clientFetch) : null;
  let sent = 0;
  await Promise.all(
    tokens.map(async (t) => {
      const req =
        t.platform === 'ios' && apns && apnsToken
          ? apnsRequest(apns, apnsToken, t.token, message)
          : t.platform === 'android' && fcm && fcmToken
            ? fcmRequest(fcm, fcmToken, t.token, message)
            : null;
      if (!req) return;
      const res = await clientFetch(req.url, req.init);
      if (res.ok) sent++;
      else {
        const body = await res.text();
        if (isDeadToken(t.platform, res.status, body)) await db.from('native_push_tokens').delete().eq('token', t.token);
        else failures.push(`${t.platform} ${res.status} ${body}`.slice(0, 200));
      }
    }),
  );
  return sent;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-notify-secret') !== env('NOTIFY_SECRET')) return new Response('forbidden', { status: 403 });
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

  const { data: members, error } = await db.from('members').select('user_id').eq('group_id', record.group_id).in('player_id', targets);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const users = (members ?? []).map((m) => m.user_id);
  if (users.length === 0) return new Response('no devices');

  failures = [];
  const [web, native] = await Promise.all([sendWeb(record.group_id, users, message), sendNative(record.group_id, users, message)]);
  return Response.json({ web, native, ...(failures.length && { failures }) });
});

/**
 * Push notifications end to end on the local stack: events trigger (pg_net) → notify Edge Function →
 * a mock push service on https://host.docker.internal:9443 (self-signed CA, trusted via PUSH_TEST_CA):
 *  - Web Push: payload decrypted with the subscriber's own keys (RFC 8291), as a browser would.
 *  - APNs: ES256 provider token verified with the key's public half; alert payload checked.
 *  - FCM: RS256 service-account assertion verified, access token issued, message checked.
 *
 * Needs a stack started with the secrets in supabase/functions/.env.local, plus
 * PUSH_E2E=1 PUSH_TLS_DIR=<dir with cert.pem, key.pem, apns-pub.pem, fcm-pub.pem> NOTIFY_SECRET=<same>.
 */
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify, type ECDH } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:https';
import { asGroupId, asPlayerId, type LedgerEvent, type PlayerId } from '@coffee/core';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createSupabaseRemote } from '../src';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TLS = process.env.PUSH_TLS_DIR;
const SECRET = process.env.NOTIFY_SECRET;
const PORT = Number(process.env.PUSH_MOCK_PORT ?? 9443);
const enabled = !!(process.env.PUSH_E2E && URL && ANON && SERVICE && TLS && SECRET);

interface Delivery {
  path: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

/** Decrypts an aes128gcm Web Push message body for the given subscriber keys. */
function decrypt(body: Buffer, ua: ECDH, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const senderPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const shared = ua.computeSecret(senderPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), senderPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  let end = plain.length - 1;
  while (plain[end] === 0) end--; // padding, then the 0x02 last-record delimiter
  return plain.subarray(0, end).toString('utf8');
}

/** Verifies a compact JWS with the given PEM public key; returns its claims. */
function verifyJwt(jwt: string, publicPem: string, alg: 'ES256' | 'RS256') {
  const [h, c, s] = jwt.split('.') as [string, string, string];
  const ok = verify(
    'sha256',
    Buffer.from(`${h}.${c}`),
    alg === 'ES256' ? { key: createPublicKey(publicPem), dsaEncoding: 'ieee-p1363' } : createPublicKey(publicPem),
    Buffer.from(s, 'base64url'),
  );
  expect(ok).toBe(true);
  return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as Record<string, unknown>;
}

const remote = () =>
  createSupabaseRemote(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as never } });
let n = 0;
const uid = () => `p${Date.now().toString(36)}${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ev = (groupId: string, actorId: string, payload: Record<string, unknown>) =>
  ({ id: uid(), groupId, actorId, at: new Date().toISOString(), schemaVersion: 1, ...payload }) as unknown as LedgerEvent;
const joined = (groupId: string, id: PlayerId, name: string, role: 'owner' | 'member') =>
  ev(groupId, id, { type: 'PlayerJoined', player: { id, name, role, appearance: { color: '#000' }, archived: false } });

/** 지원 (A, owner) with members 민수 (B) and 하나 (C), each on their own account. */
async function group() {
  const devices = { a: remote(), b: remote(), c: remote() };
  for (const d of Object.values(devices)) await d.ensureSession();
  const groupId = asGroupId(uid());
  const ids = { a: asPlayerId(uid()), b: asPlayerId(uid()), c: asPlayerId(uid()) };
  const { inviteCode } = await devices.a.createGroup({ groupId, playerId: ids.a, name: 'push' });
  await devices.a.push([joined(groupId, ids.a, '지원', 'owner')]);
  for (const [who, name] of [['b', '민수'], ['c', '하나']] as const) {
    await devices[who].joinGroup(inviteCode);
    await devices[who].claimPlayer(groupId, ids[who]);
    await devices[who].push([joined(groupId, ids[who], name, 'member')]);
  }
  return { devices, ids, groupId };
}

describe.skipIf(!enabled)('push end to end', () => {
  const deliveries: Delivery[] = [];
  let server: ReturnType<typeof createServer>;
  const admin = enabled ? createClient(URL!, SERVICE!, { auth: { persistSession: false }, realtime: { transport: WebSocket as never } }) : null;

  const waitFor = async (count: number) => {
    for (let i = 0; i < 200 && deliveries.length < count; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500)); // time for a wrongly targeted extra push to show up
  };

  beforeAll(async () => {
    server = createServer({ key: readFileSync(`${TLS}/key.pem`), cert: readFileSync(`${TLS}/cert.pem`) }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        // The FCM OAuth exchange is plumbing, not a delivery.
        if (req.url === '/token') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'test-access', expires_in: 3600 }));
          deliveries.push({ path: '/token', headers: req.headers, body });
          return;
        }
        deliveries.push({ path: req.url ?? '', headers: req.headers, body });
        res.writeHead(200).end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(PORT, '0.0.0.0', r));
    const { error } = await admin!
      .from('notify_config')
      .upsert({ id: 1, url: 'http://supabase_kong_coffee-maker:8000/functions/v1/notify', secret: SECRET });
    expect(error).toBeNull();
  });

  beforeEach(() => {
    deliveries.length = 0;
  });

  afterAll(async () => {
    await admin?.from('notify_config').delete().eq('id', 1);
    server?.close();
  });

  it('web push: only the late player is notified, with a payload their browser can decrypt', async () => {
    const { devices, ids, groupId } = await group();
    const keys = { a: createECDH('prime256v1'), b: createECDH('prime256v1') };
    keys.a.generateKeys();
    keys.b.generateKeys();
    const auth = { a: randomBytes(16), b: randomBytes(16) };
    for (const who of ['a', 'b'] as const) {
      await devices[who].savePushSubscription(groupId, {
        endpoint: `https://host.docker.internal:${PORT}/push/${who}`,
        keys: { p256dh: keys[who].getPublicKey().toString('base64url'), auth: auth[who].toString('base64url') },
      });
    }

    await devices.a.push([ev(groupId, ids.a, { type: 'LateRecorded', playerId: ids.b, cups: 1 })]);
    await waitFor(1);

    expect(deliveries.map((d) => d.path)).toEqual(['/push/b']);
    const [d] = deliveries;
    expect(d!.headers['content-encoding']).toBe('aes128gcm');
    expect(String(d!.headers.authorization)).toMatch(/^vapid t=.+, k=.+/);
    const message = JSON.parse(decrypt(d!.body, keys.b, auth.b));
    expect(message).toMatchObject({ body: '지원님이 업보 1잔을 청구했습니다 ☕', tag: `late:${ids.b}`, url: '/' });
  }, 40_000);

  it('native push: APNs for iOS and FCM for Android, signed with the configured keys', async () => {
    const { devices, ids, groupId } = await group();
    await devices.b.saveNativePushToken(groupId, 'ios-device-token', 'ios');
    await devices.c.saveNativePushToken(groupId, 'android-device-token', 'android');

    await devices.a.push([
      ev(groupId, ids.a, { type: 'LateRecorded', playerId: ids.b, cups: 2 }),
      ev(groupId, ids.a, { type: 'LateRecorded', playerId: ids.c, cups: 1 }),
    ]);
    await waitFor(3);

    const apns = deliveries.find((d) => d.path.startsWith('/3/device/'));
    expect(apns?.path).toBe('/3/device/ios-device-token');
    expect(apns!.headers['apns-topic']).toBe('app.coffeemaker.underworld');
    expect(apns!.headers['apns-push-type']).toBe('alert');
    const apnsClaims = verifyJwt(String(apns!.headers.authorization).replace(/^bearer /, ''), readFileSync(`${TLS}/apns-pub.pem`, 'utf8'), 'ES256');
    expect(apnsClaims.iss).toBe('TESTTEAM');
    expect(JSON.parse(apns!.body.toString()).aps.alert.body).toBe('지원님이 업보 2잔을 청구했습니다 ☕');

    const token = deliveries.find((d) => d.path === '/token');
    const assertion = new URLSearchParams(token!.body.toString()).get('assertion')!;
    expect(verifyJwt(assertion, readFileSync(`${TLS}/fcm-pub.pem`, 'utf8'), 'RS256').scope).toBe(
      'https://www.googleapis.com/auth/firebase.messaging',
    );
    const fcm = deliveries.find((d) => d.path.startsWith('/v1/projects/'));
    expect(fcm?.path).toBe('/v1/projects/coffee-test/messages:send');
    expect(fcm!.headers.authorization).toBe('Bearer test-access');
    expect(JSON.parse(fcm!.body.toString()).message).toMatchObject({
      token: 'android-device-token',
      notification: { body: '지원님이 업보 1잔을 청구했습니다 ☕' },
    });
    // Nothing else (no web push, nothing for the actor).
    expect(deliveries).toHaveLength(3);
  }, 40_000);
});

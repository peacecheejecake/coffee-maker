// Native push senders (APNs for iOS, FCM HTTP v1 for Android) using only WebCrypto + fetch, so the same
// code runs in Deno (Edge Function) and in Node tests.
import type { PushMessage } from './message.ts';

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const s = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

/** PEM (PKCS#8) → raw DER bytes. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

async function signJwt(header: object, claims: object, key: CryptoKey, alg: AlgorithmIdentifier | EcdsaParams) {
  const input = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const sig = await crypto.subtle.sign(alg, key, new TextEncoder().encode(input));
  // WebCrypto ECDSA already returns the raw r||s form JOSE expects.
  return `${input}.${b64url(sig)}`;
}

// ── APNs ──────────────────────────────────────────────────────────────────

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** Contents of the .p8 key (PKCS#8 PEM). */
  privateKey: string;
  bundleId: string;
  production: boolean;
  /** Override for tests (a mock APNs). Defaults to Apple's sandbox/production host. */
  origin?: string;
}

/** Provider token for APNs (ES256), valid up to an hour. */
export async function apnsJwt(cfg: ApnsConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(cfg.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return signJwt({ alg: 'ES256', kid: cfg.keyId }, { iss: cfg.teamId, iat: nowSeconds }, key, { name: 'ECDSA', hash: 'SHA-256' });
}

export const apnsRequest = (cfg: ApnsConfig, jwt: string, token: string, m: PushMessage) => ({
  url: `${cfg.origin ?? `https://${cfg.production ? 'api.push.apple.com' : 'api.sandbox.push.apple.com'}`}/3/device/${token}`,
  init: {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': cfg.bundleId,
      'apns-push-type': 'alert',
      'apns-collapse-id': m.tag.slice(0, 64),
    },
    body: JSON.stringify({ aps: { alert: { title: m.title, body: m.body }, sound: 'default' }, url: m.url }),
  },
});

// ── FCM HTTP v1 ───────────────────────────────────────────────────────────

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  /** Service-account private key (PKCS#8 PEM). */
  privateKey: string;
  /** Overrides for tests (a mock FCM). */
  origin?: string;
  tokenUrl?: string;
}

/** Signed assertion exchanged at Google's token endpoint for an FCM access token (RS256). */
export async function fcmAssertion(cfg: FcmConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(cfg.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: cfg.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: cfg.tokenUrl ?? 'https://oauth2.googleapis.com/token',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    },
    key,
    { name: 'RSASSA-PKCS1-v1_5' },
  );
}

export async function fcmAccessToken(cfg: FcmConfig, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(cfg.tokenUrl ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await fcmAssertion(cfg) }),
  });
  if (!res.ok) throw new Error(`fcm token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export const fcmRequest = (cfg: FcmConfig, accessToken: string, token: string, m: PushMessage) => ({
  url: `${cfg.origin ?? 'https://fcm.googleapis.com'}/v1/projects/${cfg.projectId}/messages:send`,
  init: {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: m.title, body: m.body },
        android: { collapse_key: m.tag.slice(0, 64), notification: { tag: m.tag } },
        data: { url: m.url },
      },
    }),
  },
});

/** Status codes meaning the device token is dead and should be deleted. */
export const isDeadToken = (platform: 'ios' | 'android', status: number, body: string) =>
  platform === 'ios' ? status === 410 || (status === 400 && body.includes('BadDeviceToken')) : status === 404 || body.includes('UNREGISTERED');

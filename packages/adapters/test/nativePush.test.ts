import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { apnsJwt, apnsRequest, fcmAssertion, fcmRequest, isDeadToken, pemToDer } from '../../../supabase/functions/notify/native';

const message = { title: 'T', body: '지원님이 업보 1잔을 청구했습니다 ☕', tag: 'late:B', url: '/' };

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

async function verify(jwt: string, publicPem: string, algorithm: 'ES256' | 'RS256') {
  const [h, c, s] = jwt.split('.') as [string, string, string];
  const params =
    algorithm === 'ES256'
      ? { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } }
      : { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } };
  const key = await webcrypto.subtle.importKey('spki', pemToDer(publicPem), params.import, false, ['verify']);
  return webcrypto.subtle.verify(params.verify, key, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
}

describe('native push', () => {
  it('APNs provider token is a valid ES256 JWT for the team and key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const cfg = {
      keyId: 'KEY123',
      teamId: 'TEAM456',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      bundleId: 'app.coffeemaker.underworld',
      production: false,
    };
    const jwt = await apnsJwt(cfg, 1_800_000_000);
    expect(decode(jwt.split('.')[0]!)).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(decode(jwt.split('.')[1]!)).toEqual({ iss: 'TEAM456', iat: 1_800_000_000 });
    expect(await verify(jwt, publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'ES256')).toBe(true);

    const req = apnsRequest(cfg, jwt, 'abcd', message);
    expect(req.url).toBe('https://api.sandbox.push.apple.com/3/device/abcd');
    expect(req.init.headers).toMatchObject({ 'apns-topic': 'app.coffeemaker.underworld', 'apns-push-type': 'alert' });
    expect(JSON.parse(req.init.body).aps.alert.body).toBe(message.body);
  });

  it('FCM assertion is a valid RS256 JWT for the messaging scope', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const cfg = {
      projectId: 'coffee-proj',
      clientEmail: 'push@coffee-proj.iam.gserviceaccount.com',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    const jwt = await fcmAssertion(cfg, 1_800_000_000);
    expect(decode(jwt.split('.')[1]!)).toMatchObject({
      iss: cfg.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      exp: 1_800_003_600,
    });
    expect(await verify(jwt, publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'RS256')).toBe(true);

    const req = fcmRequest(cfg, 'ACCESS', 'device-token', message);
    expect(req.url).toBe('https://fcm.googleapis.com/v1/projects/coffee-proj/messages:send');
    expect(JSON.parse(req.init.body).message).toMatchObject({ token: 'device-token', notification: { body: message.body } });
  });

  it('recognises dead tokens per platform', () => {
    expect(isDeadToken('ios', 410, '')).toBe(true);
    expect(isDeadToken('ios', 400, '{"reason":"BadDeviceToken"}')).toBe(true);
    expect(isDeadToken('ios', 500, '')).toBe(false);
    expect(isDeadToken('android', 404, '')).toBe(true);
    expect(isDeadToken('android', 400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}')).toBe(true);
  });
});

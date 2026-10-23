import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs script without type declarations
import { appleAppSiteAssociation, assetLinks, withAssociatedDomain, withVerifiedIntent } from '../configure-app-links.mjs';

describe('app links configuration', () => {
  it('associates the app with /join/* and /demo', () => {
    expect(appleAppSiteAssociation('TEAM123').applinks.details[0]).toEqual({
      appIDs: ['TEAM123.app.coffeemaker.underworld'],
      components: [{ '/': '/join/*' }, { '/': '/demo' }],
    });
    expect(assetLinks('AA:BB')[0].target).toMatchObject({ package_name: 'app.coffeemaker.underworld', sha256_cert_fingerprints: ['AA:BB'] });
  });

  it('adds the iOS associated domain idempotently', () => {
    const base = readFileSync('apps/mobile/ios/App/App/App.entitlements', 'utf8');
    const once = withAssociatedDomain(base, 'a.example.com');
    const twice = withAssociatedDomain(withAssociatedDomain(once, 'old.example.com'), 'a.example.com');
    expect(once).toContain('<string>applinks:a.example.com</string>');
    expect(once).toContain('aps-environment');
    expect(twice).toBe(once);
  });

  it('adds one verified Android intent filter, replaced on re-run', () => {
    const base = readFileSync('apps/mobile/android/app/src/main/AndroidManifest.xml', 'utf8');
    const once = withVerifiedIntent(base, 'a.example.com');
    const again = withVerifiedIntent(once, 'b.example.com');
    expect(once).toContain('android:autoVerify="true"');
    expect(once).toContain('android:host="a.example.com"');
    expect(again).not.toContain('a.example.com');
    expect(again.match(/autoVerify/g)).toHaveLength(1);
    expect(again).toContain('android:scheme="coffeemaker"');
  });
});

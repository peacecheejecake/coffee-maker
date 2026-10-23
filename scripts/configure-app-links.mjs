#!/usr/bin/env node
/**
 * Universal Links (iOS) and App Links (Android): makes https://<domain>/join/<code> and /demo open the
 * native app. Writes the two site association files the web build serves under /.well-known/, the iOS
 * Associated Domains entitlement, and Android's verified intent filter.
 *
 *   node scripts/configure-app-links.mjs --domain coffee.example.com --team ABCDE12345 \
 *     --android-sha256 AA:BB:...(release signing certificate fingerprint)
 *
 * Re-running replaces the previous configuration. Without these values the app still opens through
 * the custom scheme coffeemaker://.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const BUNDLE_ID = 'app.coffeemaker.underworld';
const PATHS = ['/join/*', '/demo'];

export function appleAppSiteAssociation(teamId) {
  return {
    applinks: {
      details: [{ appIDs: [`${teamId}.${BUNDLE_ID}`], components: PATHS.map((p) => ({ '/': p })) }],
    },
  };
}

export function assetLinks(sha256) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: BUNDLE_ID, sha256_cert_fingerprints: [sha256] },
    },
  ];
}

export function withAssociatedDomain(entitlementsXml, domain) {
  const cleaned = entitlementsXml.replace(/\s*<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>[\s\S]*?<\/array>/, '');
  return cleaned.replace(
    /<\/dict>\s*<\/plist>\s*$/,
    `\t<key>com.apple.developer.associated-domains</key>\n\t<array>\n\t\t<string>applinks:${domain}</string>\n\t</array>\n</dict>\n</plist>\n`,
  );
}

export function withVerifiedIntent(manifestXml, domain) {
  const marker = '<!-- app-links -->';
  const cleaned = manifestXml.replace(new RegExp(`\\s*${marker}[\\s\\S]*?${marker}`), '');
  const filter = `
            ${marker}
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${domain}" android:pathPrefix="/join/" />
                <data android:scheme="https" android:host="${domain}" android:path="/demo" />
            </intent-filter>
            ${marker}`;
  const at = cleaned.indexOf('</activity>');
  return `${cleaned.slice(0, at)}${filter.trimEnd()}\n        ${cleaned.slice(at)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { domain: { type: 'string' }, team: { type: 'string' }, 'android-sha256': { type: 'string' } },
  });
  if (!values.domain || !values.team || !values['android-sha256']) {
    console.error('usage: --domain <host> --team <Apple Team ID> --android-sha256 <signing cert SHA-256>');
    process.exit(1);
  }
  const wellKnown = 'apps/web/public/.well-known';
  mkdirSync(wellKnown, { recursive: true });
  writeFileSync(`${wellKnown}/apple-app-site-association`, JSON.stringify(appleAppSiteAssociation(values.team), null, 2));
  writeFileSync(`${wellKnown}/assetlinks.json`, JSON.stringify(assetLinks(values['android-sha256']), null, 2));
  const ent = 'apps/mobile/ios/App/App/App.entitlements';
  writeFileSync(ent, withAssociatedDomain(readFileSync(ent, 'utf8'), values.domain));
  const manifest = 'apps/mobile/android/app/src/main/AndroidManifest.xml';
  writeFileSync(manifest, withVerifiedIntent(readFileSync(manifest, 'utf8'), values.domain));
  console.log(`configured app links for https://${values.domain} (then: pnpm --filter @coffee/mobile sync)`);
}

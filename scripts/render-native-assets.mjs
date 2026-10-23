#!/usr/bin/env node
// Renders the app icon and launch screen for the native shell from apps/web/public/icons/icon.svg
// (replacing Capacitor's placeholder art). iOS: 1024 icon + 2732 splash; Android: legacy launcher icons.
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('apps/web/public/icons/icon.svg', 'utf8');
const ios = 'apps/mobile/ios/App/App/Assets.xcassets';
const android = 'apps/mobile/android/app/src/main/res';

const jobs = [
  // iOS icons must be opaque and square (the system applies the mask).
  { out: `${ios}/AppIcon.appiconset/AppIcon-512@2x.png`, size: 1024, logo: 1, radius: 0 },
  ...['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'].map((f) => ({
    out: `${ios}/Splash.imageset/${f}`,
    size: 2732,
    logo: 0.22,
    radius: 112,
  })),
];
if (existsSync(android)) {
  for (const [dir, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    jobs.push({ out: `${android}/mipmap-${dir}/ic_launcher.png`, size, logo: 1, radius: 0 });
    jobs.push({ out: `${android}/mipmap-${dir}/ic_launcher_round.png`, size, logo: 1, radius: 0 });
  }
}

const browser = await chromium.launch({ channel: 'chrome' });
for (const { out, size, logo, radius } of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * logo);
  // Full-bleed icons drop the rounded corners of the source art.
  const art = radius === 0 ? svg.replace('rx="112"', 'rx="0"') : svg;
  await page.setContent(
    `<html><body style="margin:0;background:#141226;display:grid;place-items:center;width:${size}px;height:${size}px">
       ${art.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}
     </body></html>`,
  );
  await page.screenshot({ path: out });
  await page.close();
  console.log('wrote', out);
}
await browser.close();

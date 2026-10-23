#!/usr/bin/env node
// Renders apps/web/public/icons/icon.svg to the PNG sizes the PWA manifest and iOS need,
// using the locally installed Chrome through Playwright (no image libraries required).
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const dir = 'apps/web/public/icons';
const svg = readFileSync(`${dir}/icon.svg`, 'utf8');
const targets = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  // Maskable icons must keep content inside the inner 80% safe zone.
  { file: 'icon-maskable-512.png', size: 512, pad: 0.12 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
];

const browser = await chromium.launch({ channel: 'chrome' });
for (const { file, size, pad } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:#141226;display:grid;place-items:center;width:${size}px;height:${size}px">
       <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
     </body></html>`,
  );
  await page.screenshot({ path: `${dir}/${file}`, omitBackground: pad === 0 });
  await page.close();
  console.log('wrote', file);
}
await browser.close();

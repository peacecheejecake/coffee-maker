import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// The pwa project serves this build with `vite preview`, which reads files from disk on every request:
// changing sw.js here is what a new deploy looks like to an open tab.
const SW = fileURLToPath(new URL('../../dist/sw.js', import.meta.url));
let original: string;
test.beforeAll(() => {
  original = readFileSync(SW, 'utf8');
});
test.afterEach(() => writeFileSync(SW, original));

declare global {
  interface Window {
    __before?: true;
  }
}

async function controlled(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.evaluate(() => (window.__before = true));
}

function deploy(tag: string) {
  writeFileSync(SW, `${original}\n// e2e deploy ${tag}\n`);
}

/** What the page's own ten-minute timer does, without the wait. */
const checkForUpdate = (page: Page) => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
/** False while the reload is still under way (the old page's context goes away mid-call). */
const reloaded = (page: Page) => page.evaluate(() => window.__before === undefined).catch(() => false);

test('an open tab moves to a new deploy, but not while someone is typing', async ({ page }) => {
  await controlled(page);
  await page.getByLabel('내 이름').focus();

  deploy('next');
  await checkForUpdate(page);
  // Installed and waiting, but the name field has focus: the page stays as it is.
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
  await page.waitForTimeout(3_000);
  expect(await reloaded(page)).toBe(false);

  // Done typing: it switches and reloads by itself.
  await page.getByLabel('내 이름').blur();
  await expect.poll(() => reloaded(page), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(async () => !(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
});

test('the first new-generation worker takes over pages of the old one by itself', async ({ page }) => {
  await controlled(page);
  // As if the active worker came from before the generation marker: old pages never ask it to take over.
  await page.evaluate(() => caches.delete('coffee-sw-generation-2'));
  await page.getByLabel('내 이름').focus();

  deploy('from-gen1');
  await checkForUpdate(page);
  await expect.poll(() => reloaded(page), { timeout: 15_000 }).toBe(true);
  expect(await page.evaluate(() => caches.has('coffee-sw-generation-2'))).toBe(true);
});

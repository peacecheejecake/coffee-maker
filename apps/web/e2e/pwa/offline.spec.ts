import { expect, test } from '@playwright/test';

test('installable and works offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  expect(manifest).toMatchObject({ short_name: '업보 커피', display: 'standalone' });

  // Wait until the service worker has installed and precached everything, then controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await page.getByLabel('내 이름').fill('지원');
  await page.getByRole('button', { name: '관할 구역 개설' }).click();
  await expect(page.getByRole('button', { name: /업보 청구/ })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /업보 청구/ })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
  await context.setOffline(false);
});

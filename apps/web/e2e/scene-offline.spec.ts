import { expect, test } from '@playwright/test';
import { openLedger } from './helpers';

test('if the 3D scene cannot load, the HUD keeps working and a reload brings the scene back', async ({ page, context }) => {
  await page.goto('/');
  // The scene chunk is only requested once there is a ledger to show.
  await context.setOffline(true);
  await page.getByRole('button', { name: '데모 장부로 둘러보기' }).click();

  await expect(page.getByRole('button', { name: /업보 청구/ })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  const ledger = await openLedger(page, '민수');
  await expect(ledger).toBeVisible();
  await page.keyboard.press('Escape');

  await context.setOffline(false);
  await page.getByRole('button', { name: '저승 무대 다시 불러오기' }).click();
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
  // The demo ledger survived the reload.
  await expect(page.getByRole('button', { name: /^민수의 업보 탑/ })).toHaveCount(1);
});

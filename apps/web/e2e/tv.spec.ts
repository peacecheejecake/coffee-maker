import { expect, test } from '@playwright/test';

test('/demo opens straight into the demo ledger', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('button', { name: /📜 업보 청구/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^태민의 업보 탑, 미상환 34잔/ })).toHaveCount(1);
});

test('/tv shows a leaderboard without controls', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('button', { name: /📜 업보 청구/ })).toBeVisible();
  await page.goto('/tv');
  const board = page.getByRole('complementary', { name: '업보 탑 목록' });
  await expect(board.getByRole('listitem').first()).toContainText('태민');
  await expect(board.getByRole('listitem').first()).toContainText('☕ 34');
  await expect(page.getByRole('button', { name: /업보 청구/ })).toHaveCount(0);
  await expect(page.locator('canvas')).toBeVisible();
});

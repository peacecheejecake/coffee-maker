import { expect, test } from '@playwright/test';
import { settle, startDemo, stillScene, trackErrors } from './helpers';

test('demo ledger renders without errors @visual', async ({ page }) => {
  await stillScene(page);
  const errors = trackErrors(page);
  await startDemo(page);
  await expect(page.getByRole('heading', { name: /저승 커피 채권관리공사/ })).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page).toHaveScreenshot('home.png');
});

test('tapping a tower focuses it and opens the ledger; closing returns to overview', async ({ page }) => {
  await startDemo(page);
  // 민수's tower (2nd from the left) in the 1280×800 overview.
  await page.mouse.click(395, 420);
  const sheet = page.getByRole('dialog', { name: '민수의 업보 명세서' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('미상환 7잔 · 신용등급 C 독촉 대상')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('mobile portrait framing @visual', async ({ page }) => {
  await stillScene(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await startDemo(page);
  await expect(page).toHaveScreenshot('home-mobile.png');
});

for (const [name, query] of [
  ['sandbox-3', 'players=3&maxCups=5'],
  ['sandbox-8', 'players=8&maxCups=20'],
  ['sandbox-20x40', 'players=20&maxCups=40&uniform=1'],
] as const) {
  test(`sandbox ${name} @visual`, async ({ page }) => {
    await stillScene(page);
    const errors = trackErrors(page);
    await page.goto(`/sandbox?hud=0&reduced=1&${query}`);
    await settle(page);
    expect(errors).toEqual([]);
    await expect(page).toHaveScreenshot(`${name}.png`, { mask: [page.getByTestId('probe')] });
  });
}

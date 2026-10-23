import { expect, test, type Page } from '@playwright/test';

/** Collects console errors and page exceptions so a test can assert the scene loaded cleanly. */
function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/**
 * Fonts load in a worker and the scene renders on demand; give both time to settle.
 * (networkidle is unreliable against the Vite dev server's HMR socket.)
 */
async function settle(page: Page) {
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(3500);
}

test('home renders the demo ledger without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await settle(page);
  await expect(page.getByRole('heading', { name: /저승 커피 채권관리공사/ })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page).toHaveScreenshot('home.png');
});

test('focus deep link shows the player card', async ({ page }) => {
  await page.goto('/?focus=p4');
  await settle(page);
  await expect(page.getByText('미상환 12잔 · 등급 D')).toBeVisible();
  await expect(page).toHaveScreenshot('home-focus.png');
});

test('tapping a tower focuses it; tapping empty space returns to overview', async ({ page }) => {
  await page.goto('/');
  await settle(page);
  // 민수's tower (2nd from the left) in the 1280×800 overview.
  await page.mouse.click(395, 420);
  await expect(page.getByText('미상환 7잔 · 등급 C')).toBeVisible();
  await page.mouse.click(1150, 760);
  await expect(page.getByText('미상환 7잔 · 등급 C')).toBeHidden();
});

test('mobile portrait framing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await settle(page);
  await expect(page).toHaveScreenshot('home-mobile.png');
});

for (const [name, query] of [
  ['sandbox-3', 'players=3&maxCups=5'],
  ['sandbox-8', 'players=8&maxCups=20'],
  ['sandbox-20x40', 'players=20&maxCups=40&uniform=1'],
] as const) {
  test(`sandbox ${name}`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`/sandbox?hud=0&${query}`);
    await settle(page);
    expect(errors).toEqual([]);
    await expect(page).toHaveScreenshot(`${name}.png`, { mask: [page.getByTestId('probe')] });
  });
}

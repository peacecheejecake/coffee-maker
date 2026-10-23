import { expect, test, type Page } from '@playwright/test';
import { addPlayer, createGroup, openLedger, recordLate } from './helpers';

const scene = (page: Page) => page.getByTestId('scene');

test('recording plays the drop; a tap skips it instead of selecting a tower', async ({ page }) => {
  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  await recordLate(page, '민수', '09:30');
  await expect(scene(page)).toHaveAttribute('aria-busy', 'true');
  await page.mouse.click(640, 300);
  await expect(scene(page)).toHaveAttribute('aria-busy', 'false', { timeout: 2000 });
  // The skip tap did not open anyone's ledger.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const ledger = await openLedger(page, '민수');
  await expect(ledger.getByText('미상환 1잔')).toBeVisible();
});

test('animations finish on their own', async ({ page }) => {
  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  await recordLate(page, '민수', '09:30');
  await expect(scene(page)).toHaveAttribute('aria-busy', 'true');
  await expect(scene(page)).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
});

test('reduced motion keeps animations short', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  const started = Date.now();
  await recordLate(page, '민수', '09:30');
  await expect(scene(page)).toHaveAttribute('aria-busy', 'false', { timeout: 3000 });
  expect(Date.now() - started).toBeLessThan(6000);
});

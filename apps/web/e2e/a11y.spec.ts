import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addPlayer, createGroup, openLedger, recordLate, stillScene } from './helpers';

/** Serious/critical WCAG A/AA issues only; the canvas itself is covered by the tower list. */
async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('canvas').analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('onboarding, main screen and sheets have no serious accessibility violations', async ({ page }) => {
  // Six full axe audits plus a recorded drop: ~20s alone, several times that next to other WebGL workers.
  test.setTimeout(150_000);
  await stillScene(page);
  await page.goto('/');
  expect(await audit(page)).toEqual([]);

  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  await recordLate(page, '민수', '09:30');
  expect(await audit(page)).toEqual([]);

  await page.getByRole('button', { name: /📜 업보 청구/ }).click();
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');

  await openLedger(page, '민수');
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '공사 규정' }).click();
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /상환 창구/ }).click();
  expect(await audit(page)).toEqual([]);
});

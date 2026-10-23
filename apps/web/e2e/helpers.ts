import { expect, type Page } from '@playwright/test';

/** Collects console errors and page exceptions so a test can assert the app ran cleanly. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    // Vite's dep re-optimisation on a cold server is not an app error.
    if (m.type() === 'error' && !m.text().includes('Outdated Optimize Dep')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/**
 * Fonts load in a worker and the scene renders on demand; give both time to settle.
 * (networkidle is unreliable against the Vite dev server's HMR socket.)
 */
export async function settle(page: Page) {
  await sceneReady(page);
  await page.waitForTimeout(3500);
}

/**
 * The app scene streams in the reaper model; wait for it so screenshots never catch the placeholder and
 * its first upload and shader compile do not stall the next interaction.
 */
async function sceneReady(page: Page) {
  await page.locator('canvas').waitFor();
  const scene = page.getByTestId('scene');
  if (await scene.count()) await expect(scene).toHaveAttribute('data-reaper-ready', 'true', { timeout: 30_000 });
}

/**
 * Screenshot tests need a still scene: fixed wall clock (lighting follows the time of day) and reduced
 * motion (no idle steam, wisps or sway).
 */
export async function stillScene(page: Page) {
  await page.clock.install({ time: new Date('2026-10-23T01:00:00Z') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

export async function startDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '데모 장부로 둘러보기' }).click();
  await settle(page);
}

export async function createGroup(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('내 이름').fill(name);
  await page.getByRole('button', { name: '관할 구역 개설' }).click();
  await expect(page.getByRole('button', { name: /업보 청구/ })).toBeVisible();
  await sceneReady(page);
}

export async function addPlayer(page: Page, name: string) {
  await page.getByRole('button', { name: '공사 규정' }).click();
  await page.getByPlaceholder('이름').fill(name);
  await page.getByRole('button', { name: '+ 채무자 추가' }).click();
  await page.keyboard.press('Escape');
}

/** Records a late arrival at `time` today through the quick-record sheet. */
export async function recordLate(page: Page, name: string, time: string) {
  await page.getByRole('button', { name: /📜 업보 청구/ }).click();
  const sheet = page.getByRole('dialog', { name: '업보 청구' });
  await sheet.getByRole('button', { name, exact: true }).click();
  await sheet.getByLabel('도착 시각').fill(time);
  await sheet.getByRole('button', { name: /^청구/ }).click();
  // Software rendering can make the first drop frames slow; give the sheet time to close.
  await expect(sheet).toBeHidden({ timeout: 10_000 });
}

/** Opens a player's ledger through the accessible tower list, the way a keyboard user would (focus reveals it). */
export async function openLedger(page: Page, name: string) {
  const button = page.getByRole('button', { name: new RegExp(`^${name}의 업보 탑`) });
  await button.focus();
  await page.keyboard.press('Enter');
  return page.getByRole('dialog', { name: `${name}의 업보 명세서` });
}

export async function switchUser(page: Page, name: string) {
  await page.getByRole('button', { name: '공사 규정' }).click();
  await page.getByLabel('이 기기를 쓰는 사람').selectOption({ label: name });
  await page.keyboard.press('Escape');
}

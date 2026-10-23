import { expect, test, type Page } from '@playwright/test';
import { addPlayer, createGroup, openLedger, recordLate, switchUser } from './helpers';

/** Presses and holds the 완납 stamp for `ms`, like a finger would. */
async function holdStamp(page: Page, ms: number) {
  const box = await page.getByRole('button', { name: /완납 도장/ }).boundingBox();
  if (!box) throw new Error('stamp not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function openRedeem(page: Page) {
  await page.getByRole('button', { name: /상환 창구/ }).click();
  return page.getByRole('dialog', { name: '상환 창구' });
}

test('redeem with a clean stamp, earn the certificate, recipient confirms receipt', async ({ page }) => {
  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  await addPlayer(page, '하나');
  await recordLate(page, '민수', '09:30');
  await switchUser(page, '민수');

  const sheet = await openRedeem(page);
  await expect(sheet.getByRole('button', { name: /민수 · ☕1/ })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: '관할 구역 전원' }).click();
  await sheet.getByRole('button', { name: /날인하러 가기/ }).click();
  await holdStamp(page, 870);
  await expect(page.getByText('민수의 업보 1잔 상환 완료')).toBeVisible();

  const certificate = page.getByRole('dialog', { name: '완납 증명서' });
  await expect(certificate.getByRole('img', { name: '완납 증명서' })).toBeVisible();
  await certificate.getByRole('button', { name: '극락으로' }).click();

  const ledger = await openLedger(page, '민수');
  await expect(ledger.getByText('미상환 0잔')).toBeVisible();
  await expect(ledger.getByText('수령 확인 0/2')).toBeVisible();
  await expect(ledger.getByRole('img', { name: '깔끔한 날인 ✨' })).toBeVisible();
  await page.keyboard.press('Escape');

  await switchUser(page, '하나');
  await page.getByRole('button', { name: /심의함/ }).click();
  const box = page.getByRole('dialog', { name: '탕감 심의위원회' });
  await expect(box.getByText('민수님이 민수의 업보로 커피 1잔을 샀습니다')).toBeVisible();
  await box.getByRole('button', { name: '잘 받았습니다 ☕' }).click();
  await expect(page.getByText('수령 확인. 도장이 진해졌습니다')).toBeVisible();
});

test('a quick tap gives a faint stamp; the recorder can revert within ten minutes', async ({ page }) => {
  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  await recordLate(page, '민수', '09:30');
  await recordLate(page, '지원', '09:40');

  // 지원 pays for 민수 (proxy payment).
  const sheet = await openRedeem(page);
  await sheet.getByRole('button', { name: /민수 · ☕1/ }).click();
  await expect(sheet.getByText('대납')).toBeVisible();
  await sheet.getByRole('button', { name: '지원', exact: true }).click();
  await sheet.getByRole('button', { name: /날인하러 가기/ }).click();
  await holdStamp(page, 120);
  await expect(page.getByText('민수의 업보 1잔 상환 완료')).toBeVisible();
  await page.getByRole('dialog', { name: '완납 증명서' }).getByRole('button', { name: '극락으로' }).click();

  const ledger = await openLedger(page, '민수');
  await expect(ledger.getByRole('img', { name: '흐릿한 날인' })).toBeVisible();
  await expect(ledger.getByText(/지원 대납/)).toBeVisible();
  await ledger.getByRole('button', { name: '되돌리기' }).click();
  await expect(ledger.getByText('미상환 1잔')).toBeVisible();
  await expect(ledger.getByText('되돌림')).toBeVisible();
});

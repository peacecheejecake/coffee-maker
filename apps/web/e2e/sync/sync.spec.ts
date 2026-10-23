import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createGroup, openLedger, recordLate, trackErrors } from '../helpers';

/** A fresh browser profile = a separate device with its own anonymous account. */
async function newDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

async function inviteLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: '공사 규정' }).click();
  const input = page.getByRole('textbox', { name: '관할 구역 초대' });
  await expect(input).toHaveValue(/\/join\/[A-Z0-9]+$/);
  const url = await input.inputValue();
  await page.keyboard.press('Escape');
  return url;
}

async function joinAs(page: Page, url: string, name: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: '당신은 누구십니까?' })).toBeVisible();
  await page.getByLabel('새로 등록').fill(name);
  await page.getByRole('button', { name: '새로 등록' }).click();
  await expect(page.getByRole('button', { name: /📜 업보 청구/ })).toBeVisible();
}

const towerLabel = (page: Page, name: string, cups: number) =>
  page.getByRole('button', { name: `${name}의 업보 탑, 미상환 ${cups}잔` });

test('invite → join → live updates in both directions', async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  const errors = [...trackErrors(a.page), ...trackErrors(b.page)];

  await createGroup(a.page, '지원');
  await expect(a.page.getByRole('status', { name: '동기화됨' })).toBeVisible();
  const url = await inviteLink(a.page);

  await joinAs(b.page, url, '민수');
  await expect(a.page.getByText('민수님이 관할 구역에 합류했습니다')).toBeVisible({ timeout: 15_000 });

  await recordLate(a.page, '민수', '09:30');
  await expect(b.page.getByText('지원님이 민수에게 업보 1잔을 청구했습니다')).toBeVisible({ timeout: 15_000 });
  await expect(towerLabel(b.page, '민수', 1)).toHaveCount(1);

  await recordLate(b.page, '지원', '09:45');
  await expect(towerLabel(a.page, '지원', 1)).toHaveCount(1);

  // A fresh load on B rebuilds from the server and local cache identically.
  await b.page.reload();
  await expect(towerLabel(b.page, '민수', 1)).toHaveCount(1);
  await expect(towerLabel(b.page, '지원', 1)).toHaveCount(1);
  expect(errors).toEqual([]);
  await a.context.close();
  await b.context.close();
});

test('offline edits are queued and delivered on reconnect', async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  await createGroup(a.page, '지원');
  await joinAs(b.page, await inviteLink(a.page), '민수');
  await expect(towerLabel(b.page, '지원', 0)).toHaveCount(1);

  await b.context.setOffline(true);
  await recordLate(b.page, '지원', '09:30');
  await expect(b.page.getByRole('status', { name: /오프라인|동기화 중/ })).toBeVisible();
  await a.page.waitForTimeout(1500);
  await expect(towerLabel(a.page, '지원', 0)).toHaveCount(1);

  await b.context.setOffline(false);
  await expect(towerLabel(a.page, '지원', 1)).toHaveCount(1, { timeout: 20_000 });
  await expect(b.page.getByRole('status', { name: '동기화됨' })).toBeVisible({ timeout: 20_000 });
  await a.context.close();
  await b.context.close();
});

test('a unanimous waiver across three devices', async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  const c = await newDevice(browser);
  await createGroup(a.page, '지원');
  const url = await inviteLink(a.page);
  await joinAs(b.page, url, '민수');
  await joinAs(c.page, url, '하나');
  await expect(towerLabel(a.page, '하나', 0)).toHaveCount(1);

  await recordLate(a.page, '민수', '09:30');
  const ledger = await openLedger(a.page, '민수');
  await ledger.getByRole('button', { name: /09:30 도착/ }).click();
  await ledger.getByRole('button', { name: '탕감 심의 발의' }).click();
  await ledger.getByLabel('탕감 사유').fill('지하철 고장');
  await ledger.getByRole('button', { name: '심의에 부치기' }).click();
  await a.page.keyboard.press('Escape');

  await expect(c.page.getByText('지원님이 민수의 탕감 심의를 발의했습니다')).toBeVisible({ timeout: 15_000 });
  await c.page.getByRole('button', { name: /심의함/ }).click();
  await c.page.getByRole('dialog', { name: '탕감 심의위원회' }).getByRole('button', { name: '탕감 찬성' }).click();
  await expect(c.page.getByText('만장일치. 업보가 탕감되었습니다')).toBeVisible({ timeout: 15_000 });
  await c.page.keyboard.press('Escape');

  for (const d of [a, b, c]) await expect(towerLabel(d.page, '민수', 0)).toHaveCount(1);
  for (const d of [a, b, c]) await d.context.close();
});

test('redeem on one device, confirm receipt on another', async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  await createGroup(a.page, '지원');
  await joinAs(b.page, await inviteLink(a.page), '민수');
  await recordLate(a.page, '민수', '09:30');
  await expect(towerLabel(b.page, '민수', 1)).toHaveCount(1);

  await b.page.getByRole('button', { name: /상환 창구/ }).click();
  const sheet = b.page.getByRole('dialog', { name: '상환 창구' });
  await sheet.getByRole('button', { name: '지원', exact: true }).click();
  await sheet.getByRole('button', { name: /날인하러 가기/ }).click();
  const box = await b.page.getByRole('button', { name: /완납 도장/ }).boundingBox();
  await b.page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await b.page.mouse.down();
  await b.page.waitForTimeout(870);
  await b.page.mouse.up();

  await expect(a.page.getByText('민수님이 민수의 업보로 커피 1잔을 샀습니다')).toBeVisible({ timeout: 15_000 });
  await expect(towerLabel(a.page, '민수', 0)).toHaveCount(1);
  await a.page.getByRole('button', { name: /심의함/ }).click();
  await a.page.getByRole('button', { name: '잘 받았습니다 ☕' }).click();
  await a.page.keyboard.press('Escape');

  await b.page.getByRole('dialog', { name: '완납 증명서' }).getByRole('button', { name: '극락으로' }).click({ timeout: 10_000 });
  const ledger = await openLedger(b.page, '민수');
  await expect(ledger.getByText('수령 확인 1/1')).toBeVisible();
  await a.context.close();
  await b.context.close();
});

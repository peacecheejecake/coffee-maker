import { expect, test } from '@playwright/test';
import { addPlayer, createGroup, openLedger, recordLate, switchUser, trackErrors } from './helpers';

test('record → reload → correct → change rules: history kept, old record unchanged', async ({ page }) => {
  const errors = trackErrors(page);
  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  await recordLate(page, '민수', '09:30');
  await expect(page.getByText('민수에게 업보 1잔이 청구되었습니다')).toBeVisible();

  await page.reload();
  let ledger = await openLedger(page, '민수');
  await expect(ledger.getByText('미상환 1잔')).toBeVisible();
  await ledger.getByRole('button', { name: /09:30 도착 · 30분 지각/ }).click();
  await ledger.getByRole('button', { name: '정정', exact: true }).click();

  const correct = page.getByRole('dialog', { name: '정정 신청' });
  await correct.getByLabel('도착 시각').fill('09:05');
  await correct.getByLabel('정정 사유 (선택)').fill('출입기록 확인');
  await expect(correct.getByText('5분 지각 → ☕ 1잔')).toBeVisible();
  await correct.getByRole('button', { name: '정정', exact: true }).click();

  // Back in the ledger, with the change history.
  ledger = page.getByRole('dialog', { name: '민수의 업보 명세서' });
  await ledger.getByRole('button', { name: /09:05 도착 · 5분 지각/ }).click();
  await expect(ledger.getByText('정정됨')).toBeVisible();
  await expect(ledger.getByText(/도착 시각 09:30→09:05/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Raise grace to 10 minutes: the 5-minute record must keep its cup (not retroactive).
  await page.getByRole('button', { name: '공사 규정' }).click();
  const settings = page.getByRole('dialog', { name: '공사 규정' });
  for (let i = 0; i < 9; i++) await settings.getByRole('button', { name: '유예 시간 (분) +' }).click();
  await expect(settings.getByText('이 규정은 오늘 이후 기록부터 적용됩니다.')).toBeVisible();
  await settings.getByRole('button', { name: '저장' }).first().click();
  await expect(page.getByText('새 규정집에 도장이 찍혔습니다')).toBeVisible();
  await page.keyboard.press('Escape');

  ledger = await openLedger(page, '민수');
  await expect(ledger.getByText('미상환 1잔')).toBeVisible();
  expect(errors).toEqual([]);
});

test('undo right after recording retracts it', async ({ page }) => {
  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  await recordLate(page, '민수', '09:30');
  await page.getByRole('button', { name: '↶ 되돌리기' }).click();
  const ledger = await openLedger(page, '민수');
  await expect(ledger.getByText('미상환 0잔')).toBeVisible();
  await expect(ledger.getByText('철회')).toBeVisible();
});

test('on-time arrivals record nothing; a duplicate date warns', async ({ page }) => {
  await createGroup(page, '지원');
  await addPlayer(page, '민수');

  await page.getByRole('button', { name: /📜 업보 청구/ }).click();
  let sheet = page.getByRole('dialog', { name: '업보 청구' });
  await sheet.getByRole('button', { name: '민수', exact: true }).click();
  await sheet.getByLabel('도착 시각').fill('09:01');
  await expect(sheet.getByText('정시 출근 ✅')).toBeVisible();
  await sheet.getByRole('button', { name: '정시 출근 확인' }).click();
  await expect(page.getByText('민수 정시 출근. 저승사자가 아쉬워합니다')).toBeVisible();

  await recordLate(page, '민수', '09:30');
  await page.getByRole('button', { name: /📜 업보 청구/ }).click();
  sheet = page.getByRole('dialog', { name: '업보 청구' });
  await sheet.getByRole('button', { name: '민수', exact: true }).click();
  await sheet.getByLabel('도착 시각').fill('09:40');
  await expect(sheet.getByText('이미 업보가 청구된 날입니다.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^청구/ })).toBeDisabled();
  await sheet.getByRole('button', { name: '그래도 추가' }).click();
  await expect(sheet.getByRole('button', { name: /^청구/ })).toBeEnabled();
});

test('waiver needs every other member: proposer auto-approves, the last vote waives', async ({ page }) => {
  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  await addPlayer(page, '하나');
  await recordLate(page, '민수', '09:30');

  let ledger = await openLedger(page, '민수');
  await ledger.getByRole('button', { name: /09:30 도착/ }).click();
  await ledger.getByRole('button', { name: '탕감 심의 발의' }).click();
  await ledger.getByLabel('탕감 사유').fill('지하철 고장');
  await ledger.getByRole('button', { name: '심의에 부치기' }).click();
  await expect(ledger.getByText('심의 중').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await switchUser(page, '하나');
  await page.getByRole('button', { name: /심의함/ }).click();
  const ballots = page.getByRole('dialog', { name: '탕감 심의위원회' });
  await expect(ballots.getByText('“지하철 고장”')).toBeVisible();
  await expect(ballots.getByText('찬성 1/2')).toBeVisible();
  await ballots.getByRole('button', { name: '탕감 찬성' }).click();
  await expect(page.getByText('만장일치. 업보가 탕감되었습니다')).toBeVisible();
  await page.keyboard.press('Escape');

  ledger = await openLedger(page, '민수');
  await expect(ledger.getByText('미상환 0잔')).toBeVisible();
  await expect(ledger.getByText('탕감', { exact: true })).toBeVisible();
});

test('a single reject asks for confirmation, then rejects', async ({ page }) => {
  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  await addPlayer(page, '하나');
  await recordLate(page, '민수', '09:30');
  const ledger = await openLedger(page, '민수');
  await ledger.getByRole('button', { name: /09:30 도착/ }).click();
  await ledger.getByRole('button', { name: '탕감 심의 발의' }).click();
  await ledger.getByLabel('탕감 사유').fill('늦잠');
  await ledger.getByRole('button', { name: '심의에 부치기' }).click();
  await page.keyboard.press('Escape');

  await switchUser(page, '하나');
  await page.getByRole('button', { name: /심의함/ }).click();
  const ballots = page.getByRole('dialog', { name: '탕감 심의위원회' });
  await ballots.getByRole('button', { name: '반대' }).click();
  await expect(ballots.getByText('반대 한 표로 즉시 기각됩니다. 반대하시겠습니까?')).toBeVisible();
  await ballots.getByRole('button', { name: '반대' }).click();
  await expect(page.getByText('기각되었습니다')).toBeVisible();
  await expect(ballots.getByText('심의할 안건이 없습니다.')).toBeVisible();
});

test('a correction down to zero cups is redirected to a waiver', async ({ page }) => {
  await createGroup(page, '지원');
  await addPlayer(page, '민수');
  await recordLate(page, '민수', '09:30');
  const ledger = await openLedger(page, '민수');
  await ledger.getByRole('button', { name: /09:30 도착/ }).click();
  await ledger.getByRole('button', { name: '정정', exact: true }).click();
  const correct = page.getByRole('dialog', { name: '정정 신청' });
  await correct.getByLabel('도착 시각').fill('09:00');
  await expect(correct.getByText('0잔으로 만드는 것은 탕감입니다. 심의에 부치세요.')).toBeVisible();
  await correct.getByRole('button', { name: '탕감 심의 발의' }).click();
  await expect(page.getByRole('dialog', { name: '민수의 업보 명세서' }).getByLabel('탕감 사유')).toBeFocused();
});

test('plain tone switches wording', async ({ page }) => {
  await createGroup(page, '지원');
  await page.getByRole('button', { name: '공사 규정' }).click();
  await page.getByRole('radio', { name: '일반' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /지각 기록/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /지각 커피 장부/ })).toBeVisible();
});

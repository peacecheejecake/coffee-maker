import { expect, test } from '@playwright/test';
import { createGroup, trackErrors } from './helpers';

test('attendance mode: the owner confirms the first rules; alone, later changes need no vote', async ({ page }) => {
  const errors = trackErrors(page);
  // The calendar opens on the current month; pin the clock so the October days below exist.
  await page.clock.install({ time: new Date('2026-10-23T01:00:00Z') });
  await createGroup(page, '지원', 'attendance');
  await expect(page.getByRole('button', { name: /규정 확정 대기/ })).toBeDisabled();

  await page.getByRole('button', { name: '공사 규정' }).click();
  const settings = page.getByRole('dialog', { name: '공사 규정' });
  await settings.getByRole('button', { name: '이 규정으로 확정' }).click();
  await settings.getByRole('alert').getByRole('button', { name: '이 규정으로 확정' }).click();
  await expect(page.getByText(/규정이 확정되었습니다/)).toBeVisible();
  // Alone in the group, a rule change passes on the spot, so it is a plain save.
  await expect(settings.getByText(/혼자라서 바로 반영/)).toBeVisible();
  await settings.getByRole('button', { name: '유예 시간 (분) +' }).click();
  await settings.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('새 규정집에 도장이 찍혔습니다')).toBeVisible();
  await page.keyboard.press('Escape');

  // Judging starts tomorrow.
  await expect(page.getByRole('button', { name: /부터 판정/ })).toBeDisabled();

  await page.getByRole('button', { name: '일정' }).click();
  const calendar = page.getByRole('dialog', { name: '일정' });
  // Month grid: pick a day, register a vacation, find it under the list view.
  await calendar.getByRole('button', { name: /^10\. 20\./ }).click();
  await calendar.getByRole('button', { name: '휴가 등록' }).click();
  await expect(calendar.getByRole('button', { name: /^10\. 20\..*내 휴가/ })).toBeVisible();
  await calendar.getByRole('radio', { name: '목록' }).click();
  await expect(calendar.getByText(/10\. 20\./)).toBeVisible();
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { createGroup, trackErrors } from './helpers';

test('attendance mode: the owner confirms the first rules; changes then go to a vote', async ({ page }) => {
  const errors = trackErrors(page);
  await createGroup(page, '지원', 'attendance');
  await expect(page.getByRole('button', { name: /규정 확정 대기/ })).toBeDisabled();

  await page.getByRole('button', { name: '공사 규정' }).click();
  const settings = page.getByRole('dialog', { name: '공사 규정' });
  await settings.getByRole('button', { name: '이 규정으로 확정' }).click();
  await settings.getByRole('alert').getByRole('button', { name: '이 규정으로 확정' }).click();
  await expect(page.getByText(/규정이 확정되었습니다/)).toBeVisible();
  // From now on the rules section proposes instead of saving.
  await expect(settings.getByRole('button', { name: '규정 변경 발의' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Judging starts tomorrow.
  await expect(page.getByRole('button', { name: /부터 판정/ })).toBeDisabled();

  await page.getByRole('button', { name: '일정' }).click();
  const calendar = page.getByRole('dialog', { name: '일정' });
  await calendar.getByLabel('날짜').last().fill('2026-10-20');
  await calendar.getByRole('button', { name: '휴가 등록' }).click();
  await expect(calendar.getByText(/10\. 20\./)).toBeVisible();
  expect(errors).toEqual([]);
});

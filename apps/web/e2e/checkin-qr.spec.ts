import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import qrcode from 'qrcode-generator';
import { createGroup, trackErrors } from './helpers';

/** With the random source pinned to zeros (below), the issued code is all 'A'. */
const CODE = 'A'.repeat(20);

/** A Y4M clip of the printed QR, for Chrome's fake camera: what the phone would see held up to the wall. */
function qrClip(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = 480;
  const cell = Math.floor(size / (n + 8));
  const offset = Math.floor((size - n * cell) / 2);
  const luma = Buffer.alloc(size * size, 235);
  for (let y = 0; y < n * cell; y++) {
    for (let x = 0; x < n * cell; x++) {
      if (qr.isDark(Math.floor(y / cell), Math.floor(x / cell))) luma[(offset + y) * size + offset + x] = 16;
    }
  }
  const chroma = Buffer.alloc((size / 2) * (size / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma]);
  const file = join(tmpdir(), `checkin-qr-${process.pid}.y4m`);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${size} H${size} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
  return file;
}

test.use({
  permissions: ['camera'],
  launchOptions: {
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${qrClip(`https://coffee-maker-wheat.vercel.app/?checkin=${CODE}`)}`,
    ],
  },
});

test('check-in QR: issued with the rules, then scanned with the camera to check in', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    const real = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T =>
      array instanceof Uint8Array && array.length === 20 ? (array.fill(0) as T) : real(array);
  });
  await page.clock.install({ time: new Date('2026-10-23T01:00:00Z') });
  await createGroup(page, '지원', 'attendance');

  await page.getByRole('button', { name: '공사 규정' }).click();
  const settings = page.getByRole('dialog', { name: '공사 규정' });
  await settings.getByRole('button', { name: 'QR 발급' }).click();
  const issued = page.getByRole('dialog', { name: '출두 QR 발급' });
  await expect(issued.getByRole('img', { name: '출두 QR' })).toBeVisible();
  await expect(issued.getByRole('link', { name: '이미지 저장' })).toBeVisible();
  await issued.getByRole('button', { name: '닫기' }).last().click();
  await expect(settings.getByText(/사용 중 · 붙여 둔 QR/)).toBeVisible();
  await settings.getByRole('button', { name: '이 규정으로 확정' }).click();
  await settings.getByRole('alert').getByRole('button', { name: '이 규정으로 확정' }).click();
  await expect(page.getByText(/규정이 확정되었습니다/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Monday 09:05 in Seoul: judging has started.
  await page.clock.setSystemTime(new Date('2026-10-26T00:05:00Z'));
  await page.reload();
  await page.getByRole('button', { name: /QR 찍고 출두/ }).click();
  await expect(page.getByRole('button', { name: /출두 완료/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/5분 늦은 출두/)).toBeVisible();
  expect(errors).toEqual([]);
});

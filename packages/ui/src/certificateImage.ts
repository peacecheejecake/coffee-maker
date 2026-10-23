import type { Translate } from '@coffee/theme';
import { drawSeal } from './stamp';

export interface CertificateInput {
  name: string;
  date: string;
  cups: number;
  cleanStamps: number;
}

/** Renders the shareable "완납 증명서" card (1080×1350, Instagram portrait) to a PNG blob. */
export async function renderCertificate(input: CertificateInput, t: Translate): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  await document.fonts?.ready;

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1b1830');
  bg.addColorStop(1, '#2c2747');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Parchment
  ctx.fillStyle = '#f5ecd9';
  roundRect(ctx, 90, 120, W - 180, H - 240, 36);
  ctx.fill();
  ctx.strokeStyle = '#c9a86a';
  ctx.lineWidth = 6;
  roundRect(ctx, 120, 150, W - 240, H - 300, 24);
  ctx.stroke();

  ctx.fillStyle = '#2a2738';
  ctx.textAlign = 'center';
  ctx.font = '700 84px Pretendard, sans-serif';
  ctx.fillText(t('certificate.title'), W / 2, 300);
  ctx.font = '700 64px Pretendard, sans-serif';
  ctx.fillText(input.name, W / 2, 440);

  ctx.font = '500 38px Pretendard, sans-serif';
  wrap(ctx, t('certificate.body', { name: input.name }), W / 2, 540, W - 340, 58);
  ctx.fillStyle = '#6b5a7a';
  ctx.font = '500 34px Pretendard, sans-serif';
  ctx.fillText(t('certificate.stats', { cups: input.cups, clean: input.cleanStamps }), W / 2, 800);
  ctx.fillText(input.date, W / 2, 860);

  const seal = document.createElement('canvas');
  seal.width = seal.height = 300;
  const sctx = seal.getContext('2d');
  if (sctx) {
    drawSeal(sctx, 300, 'clean', input.cups + input.cleanStamps);
    ctx.drawImage(seal, W / 2 - 150, 900);
  }
  ctx.font = '600 30px Pretendard, sans-serif';
  ctx.fillStyle = '#8a7a9a';
  ctx.fillText(`💀 ${t('app.title')}`, W / 2, H - 170);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Centered word wrap for Korean text (breaks on spaces). */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  let line = '';
  let yy = y;
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else line = next;
  }
  if (line) ctx.fillText(line, x, yy);
}

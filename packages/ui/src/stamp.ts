import type { StampQuality } from '@coffee/core';

/** Holding the stamp fills the gauge to 1 in `fillSeconds`; it keeps going (overfill) up to `max`. */
export const STAMP = { fillSeconds: 1.2, max: 1.3, clean: [0.6, 0.85] as const };

export const gaugeAt = (heldSeconds: number) => Math.min(STAMP.max, Math.max(0, heldSeconds / STAMP.fillSeconds));

/** DESIGN.md §3.2: too short is faint, too long smudges, the sweet spot is clean. Cosmetic only. */
export function stampQuality(gauge: number): StampQuality {
  if (gauge < STAMP.clean[0]) return 'faint';
  if (gauge > STAMP.clean[1]) return 'smudged';
  return 'clean';
}

const SEAL_RED = '#d23b2f';

/**
 * Draws the "完納" seal. Faint seals miss ink in patches; smudged ones bleed; clean ones get a gold rim.
 * Deterministic for a given seed so the same redemption always shows the same mark.
 */
export function drawSeal(ctx: CanvasRenderingContext2D, size: number, quality: StampQuality, seed = 1) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  if (quality === 'smudged') ctx.filter = 'blur(1.6px)';
  const passes = quality === 'smudged' ? 3 : 1;
  for (let p = 0; p < passes; p++) {
    const dx = p === 0 ? 0 : (rnd() - 0.5) * size * 0.05;
    const dy = p === 0 ? 0 : (rnd() - 0.5) * size * 0.05;
    ctx.globalAlpha = quality === 'faint' ? 0.55 : p === 0 ? 0.95 : 0.35;
    ctx.strokeStyle = SEAL_RED;
    ctx.fillStyle = SEAL_RED;
    ctx.lineWidth = size * 0.045;
    ctx.beginPath();
    ctx.arc(c + dx, c + dy, size * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `700 ${size * 0.3}px "Noto Serif CJK KR", "Apple SD Gothic Neo", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('完', c + dx, c + dy - size * 0.16);
    ctx.fillText('納', c + dx, c + dy + size * 0.17);
  }
  ctx.restore();
  if (quality === 'faint') {
    // Knock out ink where the stamp did not touch the paper.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.arc(rnd() * size, rnd() * size, size * (0.02 + rnd() * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  if (quality === 'clean') {
    ctx.save();
    ctx.strokeStyle = '#e8b64c';
    ctx.lineWidth = size * 0.015;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.47, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Seal as a data URL (null where canvas is unavailable, e.g. tests). */
export function sealDataUrl(quality: StampQuality, seed = 1, size = 160): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawSeal(ctx, size, quality, seed);
  return canvas.toDataURL('image/png');
}

/** Stable small number from an id, for seal randomness. */
export const seedOf = (id: string) => [...id].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);

import { CanvasTexture, SRGBColorSpace } from 'three';

let cobweb: CanvasTexture | undefined;
let rip: CanvasTexture | undefined;

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Corner cobweb (7+ days unpaid): radial threads and a few rings, transparent background. */
export function cobwebTexture(): CanvasTexture {
  if (cobweb) return cobweb;
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.strokeStyle = 'rgba(235, 235, 245, 0.85)';
    ctx.lineWidth = 1.6;
    const spokes = 7;
    for (let i = 0; i < spokes; i++) {
      const a = (i / (spokes - 1)) * (Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 128, Math.sin(a) * 128);
      ctx.stroke();
    }
    for (const r of [26, 50, 76, 104]) {
      ctx.beginPath();
      for (let i = 0; i < spokes; i++) {
        const a = (i / (spokes - 1)) * (Math.PI / 2);
        const sag = i % 2 ? 0.92 : 1;
        const x = Math.cos(a) * r * sag;
        const y = Math.sin(a) * r * sag;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  cobweb = new CanvasTexture(c);
  cobweb.colorSpace = SRGBColorSpace;
  return cobweb;
}

/** Gravestone label (100+ days unpaid). */
export function ripTexture(): CanvasTexture {
  if (rip) return rip;
  const c = canvas(128, 160);
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#8f8a99';
    ctx.beginPath();
    ctx.moveTo(8, 160);
    ctx.lineTo(8, 56);
    ctx.arc(64, 56, 56, Math.PI, 0);
    ctx.lineTo(120, 160);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3b3745';
    ctx.font = '700 30px Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('R.I.P.', 64, 78);
    ctx.font = '28px sans-serif';
    ctx.fillText('☕', 64, 122);
  }
  rip = new CanvasTexture(c);
  rip.colorSpace = SRGBColorSpace;
  return rip;
}

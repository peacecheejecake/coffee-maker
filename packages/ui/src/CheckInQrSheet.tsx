import { checkInLink } from '@coffee/core';
import { useEffect, useMemo, useState } from 'react';
import { useT, useUi } from './context';
import { Sheet } from './primitives';

/** Where the printed QR points. The native shell's own origin (capacitor://, https://localhost) means nothing to a phone camera. */
const PUBLIC_ORIGIN = 'https://coffee-maker-wheat.vercel.app';
const linkOrigin = () =>
  typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.hostname !== 'localhost'
    ? location.origin
    : PUBLIC_ORIGIN;

type Modules = boolean[][];

async function qrModules(text: string): Promise<Modules> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** One SVG path of all dark modules: crisp at any print size. */
function modulesPath(m: Modules): string {
  let d = '';
  m.forEach((row, r) => row.forEach((dark, c) => dark && (d += `M${c} ${r}h1v1h-1z`)));
  return d;
}

/** A printable sheet: the QR with a quiet zone, the group name and what it is for. */
async function renderQrPng(m: Modules, title: string, caption: string): Promise<Blob | null> {
  const n = m.length;
  const cell = 16;
  const quiet = 4 * cell;
  const size = n * cell + quiet * 2;
  const textArea = 140;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size + textArea;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  m.forEach((row, r) => row.forEach((dark, c) => dark && ctx.fillRect(quiet + c * cell, quiet + r * cell, cell, cell)));
  ctx.textAlign = 'center';
  ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
  ctx.fillText(title, size / 2, size + 40);
  ctx.font = '28px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#444';
  ctx.fillText(caption, size / 2, size + 95);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Shows a newly issued check-in QR so it can be saved and printed. Only the code's hash goes into the rules, so
 * this is the one chance to keep the image: closing the rules form loses it (a new QR can be issued any time).
 */
export function CheckInQrSheet({ code, open, onOpenChange }: { code: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const { platform } = useUi();
  const link = useMemo(() => checkInLink(linkOrigin(), code), [code]);
  const [modules, setModules] = useState<Modules | null>(null);
  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setModules(null);
    void qrModules(link).then((m) => !cancelled && setModules(m));
    return () => {
      cancelled = true;
    };
  }, [link]);

  useEffect(() => {
    if (!modules) return;
    let cancelled = false;
    let url: string | null = null;
    void renderQrPng(modules, t('checkinQr.printTitle'), t('app.title')).then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setPng({ blob, url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [modules, t]);

  const file = png ? new File([png.blob], 'checkin-qr.png', { type: 'image/png' }) : null;
  const canShare = !!file && platform.canShare({ files: [file] });
  const n = modules?.length ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('checkinQr.issuedTitle')} description={t('checkinQr.issuedHint')}>
      <div className="cm-stack">
        <div className="cm-qr-print">
          {modules && (
            <svg viewBox={`-4 -4 ${n + 8} ${n + 8}`} role="img" aria-label={t('checkinQr.printTitle')} shapeRendering="crispEdges">
              <rect x={-4} y={-4} width={n + 8} height={n + 8} fill="#fff" />
              <path d={modulesPath(modules)} fill="#000" />
            </svg>
          )}
        </div>
        <div className="cm-row cm-wrap">
          {canShare && (
            <button type="button" className="cm-button" onClick={() => void platform.share({ files: [file!], title: t('checkinQr.printTitle') })}>
              {t('checkinQr.share')}
            </button>
          )}
          {png && (
            <a className="cm-button" href={png.url} download="출두QR.png" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {t('checkinQr.download')}
            </a>
          )}
          <button type="button" className="cm-button cm-button-primary" onClick={() => onOpenChange(false)}>
            {t('action.close')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

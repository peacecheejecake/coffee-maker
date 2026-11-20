import { parseCheckInQr } from '@coffee/core';
import { useEffect, useRef, useState } from 'react';
import { useT } from './context';
import { Sheet } from './primitives';

type CameraState = 'starting' | 'scanning' | 'denied' | 'unavailable' | 'wrongCode';

/** Decoding every frame is wasted battery: a few tries a second finds a QR as fast as a hand holds still. */
const SCAN_EVERY_MS = 150;
/** Frames are scaled down to this width before decoding; a check-in QR fills much of the view anyway. */
const SCAN_WIDTH = 480;

/**
 * Camera view that reads the check-in QR. Calls `onCode` once with the code from the first QR that carries one
 * (a check-in link or a bare code); other QRs are ignored with a hint. The camera stops when the sheet closes.
 * The decoder (jsQR, ~45 kB) loads only when the sheet opens.
 */
export function QrScannerSheet({
  open,
  onOpenChange,
  onCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCode: (code: string) => void;
}) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('checkinQr.scanTitle')} description={t('checkinQr.scanHint')}>
      {open && <QrCamera onCode={onCode} />}
    </Sheet>
  );
}

function QrCamera({ onCode }: { onCode: (code: string) => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>('starting');
  const done = useRef(onCode);
  done.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia || !ctx) return setState('unavailable');
      const [decoder, media] = await Promise.all([
        import('jsqr').then((m) => m.default),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).catch((e: unknown) => e),
      ]);
      if (stopped) return void (media instanceof MediaStream && media.getTracks().forEach((tr) => tr.stop()));
      if (!(media instanceof MediaStream)) {
        const name = media instanceof DOMException ? media.name : '';
        return setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      }
      stream = media;
      const el = video.current!;
      el.srcObject = media;
      await el.play().catch(() => {});
      setState('scanning');

      const scan = () => {
        if (stopped) return;
        const { videoWidth: w, videoHeight: h } = el;
        if (w > 0 && h > 0) {
          const scale = Math.min(1, SCAN_WIDTH / w);
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          ctx!.drawImage(el, 0, 0, canvas.width, canvas.height);
          const img = ctx!.getImageData(0, 0, canvas.width, canvas.height);
          const hit = decoder(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (hit) {
            const code = parseCheckInQr(hit.data);
            if (code) {
              stopped = true;
              done.current(code);
              return;
            }
            setState('wrongCode');
          }
        }
        timer = setTimeout(scan, SCAN_EVERY_MS);
      };
      scan();
    }

    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const message =
    state === 'denied'
      ? t('checkinQr.cameraDenied')
      : state === 'unavailable'
        ? t('checkinQr.cameraUnavailable')
        : state === 'wrongCode'
          ? t('checkinQr.wrongCode')
          : state === 'starting'
            ? t('checkinQr.starting')
            : null;
  const blocked = state === 'denied' || state === 'unavailable';
  return (
    <div className="cm-stack">
      {!blocked && (
        <div className="cm-qr-camera">
          <video ref={video} playsInline muted aria-label={t('checkinQr.scanTitle')} />
          <span className="cm-qr-frame" aria-hidden="true" />
        </div>
      )}
      {message && (
        <p className={blocked ? 'cm-errors' : 'cm-muted'} role="status">
          {message}
        </p>
      )}
    </div>
  );
}

import type { StampQuality } from '@coffee/core';
import { useEffect, useRef, useState } from 'react';
import { useT, useUi } from './context';
import { gaugeAt, sealDataUrl, STAMP, stampQuality } from './stamp';

/**
 * The 완납 도장 (DESIGN.md §3.2): press and hold to ink the stamp, release to slam it down.
 * Works with pointer and keyboard (hold Space/Enter). Vibrates harder as the gauge fills where supported.
 */
export function StampPad({ onStamp, disabled }: { onStamp: (q: StampQuality) => void; disabled?: boolean }) {
  const t = useT();
  const { platform } = useUi();
  const [gauge, setGauge] = useState(0);
  const [result, setResult] = useState<StampQuality | null>(null);
  const started = useRef<number | null>(null);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const tick = () => {
    if (started.current === null) return;
    const g = gaugeAt((performance.now() - started.current) / 1000);
    setGauge(g);
    if (Math.random() < 0.15) platform.haptic(g < 0.6 ? 'light' : g <= 0.85 ? 'medium' : 'heavy');
    frame.current = requestAnimationFrame(tick);
  };
  const press = () => {
    if (disabled || result || started.current !== null) return;
    started.current = performance.now();
    frame.current = requestAnimationFrame(tick);
  };
  const release = () => {
    if (started.current === null) return;
    cancelAnimationFrame(frame.current);
    const q = stampQuality(gaugeAt((performance.now() - started.current) / 1000));
    started.current = null;
    setResult(q);
    platform.haptic('heavy');
    onStamp(q);
  };

  const seal = result ? sealDataUrl(result, 7) : null;
  const sweet = gauge >= STAMP.clean[0] && gauge <= STAMP.clean[1];

  return (
    <div className="cm-stamp">
      <div className="cm-stamp-paper" aria-live="polite">
        {seal ? <img src={seal} alt={t(`redeem.quality.${result!}`)} className="cm-stamp-mark" /> : <span className="cm-muted">{t('redeem.stampHint')}</span>}
      </div>
      {result ? (
        <p className="cm-stamp-result">{t(`redeem.quality.${result}`)}</p>
      ) : (
        <button
          type="button"
          className={`cm-stamp-button ${sweet ? 'is-sweet' : ''}`}
          aria-label={t('redeem.stampAria')}
          disabled={disabled}
          style={{ ['--gauge' as string]: String(Math.min(1, gauge / STAMP.max)) }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            press();
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onKeyDown={(e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
              e.preventDefault();
              press();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') release();
          }}
        >
          <span className="cm-stamp-knob" aria-hidden>
            完納
          </span>
        </button>
      )}
    </div>
  );
}

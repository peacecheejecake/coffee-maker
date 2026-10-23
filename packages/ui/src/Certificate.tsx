import { playerStats, redemptionsOf, type PlayerId } from '@coffee/core';
import { useEffect, useState } from 'react';
import { renderCertificate } from './certificateImage';
import { useLedger, useT } from './context';
import { Sheet } from './primitives';

/** Shown after someone pays everything off: the shareable 완납 증명서. */
export function CertificateDialog({ playerId, onClose }: { playerId: PlayerId | null; onClose: () => void }) {
  const t = useT();
  const ledger = useLedger((s) => s.ledger);
  const wallNow = useLedger((s) => s.wallNow);
  const [png, setPng] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const player = playerId ? ledger.players[playerId] : undefined;

  useEffect(() => {
    if (!playerId || !player) return;
    let cancelled = false;
    const stats = playerStats(ledger, playerId);
    // Clean seals on this player's debt, whoever held the stamp.
    const cleanStamps = redemptionsOf(ledger, playerId).filter((r) => !r.reverted && r.stampQuality === 'clean').length;
    void renderCertificate(
      { name: player.name, date: wallNow().workDate, cups: stats.cupsRedeemed, cleanStamps },
      t,
    ).then((blob) => {
      if (cancelled || !blob) return;
      setPng(blob);
      setUrl(URL.createObjectURL(blob));
    });
    return () => {
      cancelled = true;
    };
    // Rendered once per ceremony.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const file = png ? new File([png], 'certificate.png', { type: 'image/png' }) : null;
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  return (
    <Sheet open={playerId !== null} onOpenChange={(o) => !o && onClose()} title={t('certificate.title')}>
      <div className="cm-stack">
        {url && <img src={url} alt={t('certificate.title')} className="cm-certificate" />}
        <div className="cm-row cm-wrap">
          {canShare && (
            <button type="button" className="cm-button" onClick={() => void navigator.share({ files: [file!], title: t('certificate.title') })}>
              {t('certificate.share')}
            </button>
          )}
          {url && (
            <a className="cm-button" href={url} download="완납증명서.png" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {t('certificate.download')}
            </a>
          )}
          <button type="button" className="cm-button cm-button-primary" onClick={onClose}>
            {t('certificate.close')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

import { activePlayers, outstanding, playerStats, type PlayerId, type RedeemOrder, type StampQuality } from '@coffee/core';
import { useEffect, useMemo, useState } from 'react';
import { CertificateDialog } from './Certificate';
import { useCommand, useLedger, useStoreApi, useT, useUi } from './context';
import { compressImage } from './image';
import { ColorDot, Field, Segmented, Sheet, Stepper } from './primitives';
import { StampPad } from './StampPad';

const CERTIFICATE_DELAY_MS = 3_200;

/** The redemption ceremony (DESIGN.md §3): what was bought, for whom → stamp → cups ascend to the recipients. */
export function RedeemSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const [certificateFor, setCertificateFor] = useState<PlayerId | null>(null);
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={t('redeem.title')}>
        {open && (
          <RedeemFlow
            onDone={(paidOff) => {
              onOpenChange(false);
              // Let the cups ascend and the reaper tear the statement before the certificate covers the scene.
              if (paidOff) setTimeout(() => setCertificateFor(paidOff), CERTIFICATE_DELAY_MS);
            }}
          />
        )}
      </Sheet>
      <CertificateDialog playerId={certificateFor} onClose={() => setCertificateFor(null)} />
    </>
  );
}

function RedeemFlow({ onDone }: { onDone: (paidOff: PlayerId | null) => void }) {
  const t = useT();
  const { toast, platform } = useUi();
  const run = useCommand();
  const api = useStoreApi();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const putEvidence = useLedger((s) => s.putEvidence);
  const players = activePlayers(ledger);
  const debtors = players.filter((p) => outstanding(ledger, p.id) > 0);

  const [debtorId, setDebtorId] = useState<PlayerId | undefined>(
    debtors.find((p) => p.id === me)?.id ?? debtors[0]?.id,
  );
  const owed = debtorId ? outstanding(ledger, debtorId) : 0;
  const [count, setCount] = useState(1);
  const others = useMemo(() => players.filter((p) => p.id !== debtorId), [players, debtorId]);
  const [recipients, setRecipients] = useState<PlayerId[]>([]);
  const [order, setOrder] = useState<RedeemOrder>('newest');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'stamp'>('form');
  const [busy, setBusy] = useState(false);

  useEffect(() => setCount((c) => Math.min(Math.max(1, c), Math.max(1, owed))), [owed]);
  useEffect(() => {
    if (!photo) return setPhotoUrl(null);
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (!debtorId || !me) return <p className="cm-muted">{t('redeem.nothing')}</p>;
  const everyone = others.length > 0 && others.every((p) => recipients.includes(p.id));
  const toggle = (id: PlayerId) => setRecipients((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  const nameOf = (id: PlayerId) => ledger.players[id]?.name ?? '?';

  async function stamp(stampQuality: StampQuality) {
    setBusy(true);
    let evidence: { assetId: string } | undefined;
    if (photo) {
      try {
        const assetId = await putEvidence(await compressImage(photo));
        if (assetId) evidence = { assetId };
      } catch {
        // A failed upload never blocks the redemption itself.
      }
    }
    const d = await run({
      type: 'Redeem',
      debtorId: debtorId!,
      count,
      recipients,
      order,
      stampQuality,
      ...(evidence && { evidence }),
    });
    setBusy(false);
    if (!d.ok) return;
    toast(t('redeem.done', { debtor: nameOf(debtorId!), count }));
    const after = api.getState().ledger;
    onDone(outstanding(after, debtorId!) === 0 && playerStats(after, debtorId!).cupsRedeemed > 0 ? debtorId! : null);
  }

  if (step === 'stamp') {
    return (
      <div className="cm-stack">
        <p className="cm-summary">
          {nameOf(debtorId)} · {t('redeem.preview', { count, recipients: recipients.map(nameOf).join(', ') })}
        </p>
        <StampPad onStamp={(q) => void stamp(q)} disabled={busy} />
        <button type="button" className="cm-button cm-button-ghost" onClick={() => setStep('form')} disabled={busy}>
          {t('redeem.back')}
        </button>
      </div>
    );
  }

  return (
    <form
      className="cm-form"
      onSubmit={(e) => {
        e.preventDefault();
        setStep('stamp');
      }}
    >
      <fieldset className="cm-chips">
        <legend className="cm-field-label">{t('redeem.debtor')}</legend>
        {debtors.map((p) => (
          <button
            key={p.id}
            type="button"
            className="cm-chip"
            aria-pressed={p.id === debtorId}
            onClick={() => {
              setDebtorId(p.id);
              setRecipients((r) => r.filter((x) => x !== p.id));
            }}
          >
            <ColorDot color={p.appearance.color} />
            {p.name} · ☕{outstanding(ledger, p.id)}
          </button>
        ))}
      </fieldset>

      <Field label={t('redeem.count')}>
        <Stepper label={t('redeem.count')} value={count} min={1} max={Math.max(1, owed)} onChange={setCount} />
      </Field>

      <fieldset className="cm-chips">
        <legend className="cm-field-label">{t('redeem.recipients')}</legend>
        <button
          type="button"
          className="cm-chip"
          aria-pressed={everyone}
          onClick={() => setRecipients(everyone ? [] : others.map((p) => p.id))}
        >
          {t('redeem.everyone')}
        </button>
        {others.map((p) => (
          <button key={p.id} type="button" className="cm-chip" aria-pressed={recipients.includes(p.id)} onClick={() => toggle(p.id)}>
            <ColorDot color={p.appearance.color} />
            {p.name}
          </button>
        ))}
      </fieldset>

      {owed > count && (
        <Field label={t('redeem.order')}>
          <Segmented<RedeemOrder>
            label={t('redeem.order')}
            value={order}
            options={[
              { value: 'newest', label: t('redeem.order.newest') },
              { value: 'oldest', label: t('redeem.order.oldest') },
            ]}
            onChange={setOrder}
          />
        </Field>
      )}

      <p className="cm-muted">
        {t('redeem.payer', { name: nameOf(me) })}
        {me !== debtorId && <span className="cm-badge"> {t('redeem.proxy')}</span>}
      </p>

      {api.supportsEvidence && (
        <Field label={t('redeem.evidence')}>
          {photoUrl ? (
            <div className="cm-row">
              <img src={photoUrl} alt="" className="cm-thumb" />
              <button type="button" className="cm-button cm-button-ghost" onClick={() => setPhoto(null)}>
                {t('redeem.evidenceRemove')}
              </button>
            </div>
          ) : platform.pickPhoto ? (
            <button type="button" className="cm-button" onClick={async () => setPhoto(await platform.pickPhoto!())}>
              📷 {t('redeem.evidence')}
            </button>
          ) : (
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="cm-input"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
          )}
        </Field>
      )}

      <button type="submit" className="cm-button cm-button-primary" disabled={recipients.length === 0}>
        🖋 {t('redeem.next')}
      </button>
    </form>
  );
}

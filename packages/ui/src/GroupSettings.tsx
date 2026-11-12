import { activePlayers, type GroupMode, type PlayerId } from '@coffee/core';
import { useEffect, useState } from 'react';
import { useCommand, useLedger, useStoreApi, useT, useUi } from './context';
import { SpectateForm } from './Motions';
import { ConfirmBox, Field, Segmented } from './primitives';

/** Mode switch and owner handover (owner only; everyone else sees who decides). */
export function GroupSection() {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const isOwner = !!me && ledger.players[me]?.role === 'owner';
  const owner = activePlayers(ledger).find((p) => p.role === 'owner');
  const modeLabel = (m: GroupMode) => t(`mode.${m}`);
  const [pendingMode, setPendingMode] = useState<GroupMode | null>(null);

  async function changeMode(mode: GroupMode) {
    setPendingMode(null);
    const d = await run({ type: 'ChangeMode', mode });
    if (d.ok) toast(t('mode.changed', { mode: modeLabel(mode) }));
  }

  return (
    <section className="cm-section" aria-labelledby="group-h">
      <h3 id="group-h">{t('mode.title')}</h3>
      <Segmented<GroupMode>
        label={t('mode.title')}
        value={ledger.mode}
        disabled={!isOwner}
        options={[
          { value: 'attendance', label: modeLabel('attendance') },
          { value: 'shared', label: modeLabel('shared') },
        ]}
        onChange={(m) => setPendingMode(m === ledger.mode ? null : m)}
      />
      {pendingMode && (
        <ConfirmBox
          message={t('mode.changeConfirm', { mode: modeLabel(pendingMode) })}
          confirmLabel={modeLabel(pendingMode)}
          onConfirm={() => void changeMode(pendingMode)}
          onCancel={() => setPendingMode(null)}
        />
      )}
      <p className="cm-muted">{t(ledger.mode === 'attendance' ? 'mode.attendanceHint' : 'mode.sharedHint')}</p>
      {!isOwner && <p className="cm-muted">{t('mode.ownerOnly')}</p>}
      <p className="cm-muted">{t('owner.current', { name: owner?.name ?? '?' })}</p>
      {isOwner && <OwnerTransfer me={me} />}
      {/* Spectators exist only where people check themselves in. */}
      {ledger.mode === 'attendance' && !!me && (
        <>
          <SpectateForm spectator />
          <SpectateForm spectator={false} />
        </>
      )}
    </section>
  );
}

function OwnerTransfer({ me }: { me: PlayerId }) {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const api = useStoreApi();
  const ledger = useLedger((s) => s.ledger);
  const claims = useLedger((s) => s.claims);
  const [claimed, setClaimed] = useState<PlayerId[] | null>(null);
  const [to, setTo] = useState<PlayerId | ''>('');
  const [confirming, setConfirming] = useState(false);

  // With sync, only players bound to an account can take over (the server moves the role with them).
  useEffect(() => {
    if (api.remote) void claims().then((cs) => setClaimed(cs.map((c) => c.playerId)));
  }, [api.remote, claims, ledger.playerOrder.length]);

  const candidates = activePlayers(ledger).filter((p) => p.id !== me && (!api.remote || claimed?.includes(p.id)));
  if (candidates.length === 0) return <p className="cm-muted">{t('owner.noCandidates')}</p>;

  const target = to ? ledger.players[to] : undefined;
  async function transfer() {
    setConfirming(false);
    if (!target) return;
    const d = await run({ type: 'TransferOwner', to: target.id });
    if (d.ok) toast(t('owner.transferred', { name: target.name }));
  }

  if (confirming && target) {
    return (
      <ConfirmBox
        message={t('owner.transferConfirm', { name: target.name })}
        confirmLabel={t('owner.transfer')}
        onConfirm={() => void transfer()}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <div className="cm-row cm-row-fill">
      <Field label={t('owner.pick')}>
        <select className="cm-input" value={to} onChange={(e) => setTo(e.target.value as PlayerId)}>
          <option value="" />
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <button type="button" className="cm-button" disabled={!to} onClick={() => setConfirming(true)}>
        {t('owner.transfer')}
      </button>
    </div>
  );
}

import type { PlayerId } from '@coffee/core';
import { useEffect, useState } from 'react';
import { useLedger, useT, useUi } from './context';
import { ColorDot } from './primitives';
import { PALETTE_CHOICES } from './SettingsSheet';

/** After joining by invite: bind this account to an unclaimed player or register a new one. */
export function ClaimScreen() {
  const t = useT();
  const { toast } = useUi();
  const ledger = useLedger((s) => s.ledger);
  const unclaimedPlayers = useLedger((s) => s.unclaimedPlayers);
  const claim = useLedger((s) => s.claim);
  const registerSelf = useLedger((s) => s.registerSelf);
  const [options, setOptions] = useState<PlayerId[] | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    void unclaimedPlayers().then(setOptions);
  }, [unclaimedPlayers, ledger.playerOrder.length]);

  const pick = async (id: PlayerId) => {
    try {
      await claim(id);
    } catch {
      toast(t('claim.taken'), 'error');
      setOptions(await unclaimedPlayers());
    }
  };

  return (
    <main className="cm-onboarding">
      <div className="cm-onboarding-card">
        <h1>{t('claim.title')}</h1>
        <p>{t('claim.body')}</p>
        <div className="cm-chips">
          {(options ?? []).map((id) => {
            const p = ledger.players[id];
            return p ? (
              <button key={id} type="button" className="cm-chip" onClick={() => void pick(id)}>
                <ColorDot color={p.appearance.color} />
                {t('claim.pick', { name: p.name })}
              </button>
            ) : null;
          })}
        </div>
        <form
          className="cm-form"
          onSubmit={(e) => {
            e.preventDefault();
            const color = PALETTE_CHOICES[ledger.playerOrder.length % PALETTE_CHOICES.length]!;
            void registerSelf(name, { color });
          }}
        >
          <label className="cm-field">
            <span className="cm-field-label">{t('claim.new')}</span>
            <input className="cm-input" required maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="cm-button cm-button-primary" disabled={!name.trim()}>
            {t('claim.new')}
          </button>
        </form>
      </div>
    </main>
  );
}

/** Handles /join/:code: joins, then hands back to the app. */
export function JoinScreen({ code, onDone }: { code: string; onDone: () => void }) {
  const t = useT();
  const joinByInvite = useLedger((s) => s.joinByInvite);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    joinByInvite(code).then(
      () => !cancelled && onDone(),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [code, joinByInvite, onDone]);
  return (
    <main className="cm-onboarding">
      <div className="cm-onboarding-card">
        <p>{failed ? t('join.error') : t('join.loading')}</p>
        {failed && (
          <button type="button" className="cm-button" onClick={onDone}>
            {t('join.home')}
          </button>
        )}
      </div>
    </main>
  );
}

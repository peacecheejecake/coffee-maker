import type { PlayerClaim } from '@coffee/app';
import { activePlayers, type PlayerId } from '@coffee/core';
import { useCallback, useEffect, useState } from 'react';
import { useLedger, useStoreApi, useT, useUi } from './context';
import { ColorDot } from './primitives';
import { setPeekGroup } from './session';
import { PALETTE_CHOICES } from './SettingsSheet';

/**
 * "Who are you?" for a signed-in account that has no player in the group yet: pick a name (or take back one
 * held by an anonymous session) or register a new one. It can also just watch (onPeek).
 */
export function ClaimScreen({ onPeek }: { onPeek: () => void }) {
  const t = useT();
  const { toast } = useUi();
  const ledger = useLedger((s) => s.ledger);
  const groupId = useLedger((s) => s.groupId);
  const claims = useLedger((s) => s.claims);
  const claim = useLedger((s) => s.claim);
  const registerSelf = useLedger((s) => s.registerSelf);
  const [held, setHeld] = useState<PlayerClaim[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => claims().then(setHeld, () => setHeld([])), [claims]);
  useEffect(() => {
    void refresh();
  }, [refresh, ledger.playerOrder.length]);

  const pick = useCallback(
    async (playerId: PlayerId) => {
      if (!groupId) return;
      setBusy(true);
      try {
        await claim(playerId);
      } catch {
        toast(t('claim.taken'), 'error');
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [groupId, claim, toast, t, refresh],
  );

  const register = useCallback(
    async (newName: string) => {
      if (!groupId) return;
      setBusy(true);
      try {
        const color = PALETTE_CHOICES[ledger.playerOrder.length % PALETTE_CHOICES.length]!;
        await registerSelf(newName, { color });
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        setBusy(false);
      }
    },
    [groupId, ledger.playerOrder.length, registerSelf, toast],
  );

  return (
    <main className="cm-onboarding">
      <div className="cm-onboarding-card">
        <h1>{t('claim.title')}</h1>
        <p>{t('claim.body')}</p>
        <div className="cm-chips">
          {activePlayers(ledger).map((p) => {
            const holder = held?.find((c) => c.playerId === p.id);
            // Held by a signed-in account: that person signs in to continue. Held by an anonymous one: recoverable.
            const label = !holder ? 'claim.pick' : holder.anonymous ? 'claim.recover' : 'claim.joined';
            return (
              <button
                key={p.id}
                type="button"
                className="cm-chip"
                disabled={busy || (holder && !holder.anonymous)}
                onClick={() => void pick(p.id)}
              >
                <ColorDot color={p.appearance.color} />
                {t(label, { name: p.name })}
              </button>
            );
          })}
        </div>
        <form
          className="cm-form"
          onSubmit={(e) => {
            e.preventDefault();
            void register(name);
          }}
        >
          <label className="cm-field">
            <span className="cm-field-label">{t('claim.new')}</span>
            <input className="cm-input" required maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="cm-button cm-button-primary" disabled={!name.trim() || busy}>
            {t('claim.new')}
          </button>
        </form>
        <button type="button" className="cm-button cm-button-ghost" onClick={onPeek}>
          {t('claim.peek')}
        </button>
      </div>
    </main>
  );
}

/**
 * Handles /join/:code: opens the group, then hands back to the app. A signed-in member continues as their
 * player; anyone else starts out watching, with sign-in (or, once signed in, taking part) on offer.
 */
export function JoinScreen({ code, onDone }: { code: string; onDone: () => void }) {
  const t = useT();
  const api = useStoreApi();
  const openInvite = useLedger((s) => s.openInvite);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    openInvite(code).then(
      () => {
        if (cancelled) return;
        const { groupId, me } = api.getState();
        setPeekGroup(me ? null : groupId);
        onDone();
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [code, api, openInvite, onDone]);
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

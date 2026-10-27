import type { PlayerClaim } from '@coffee/app';
import { activePlayers, type PlayerId } from '@coffee/core';
import { useCallback, useEffect, useState } from 'react';
import { useLedger, useT, useUi } from './context';
import { ColorDot } from './primitives';
import { setPeekGroup, setPendingClaim, takePendingClaim } from './session';
import { PALETTE_CHOICES } from './SettingsSheet';

/**
 * "Who are you?" for an account that has no player in the group yet: pick a name or register a new one.
 * Taking part needs a signed-in account; without one, the choice is remembered across the Google redirect.
 * Anyone can also just watch (onPeek).
 */
export function ClaimScreen({ onPeek }: { onPeek: () => void }) {
  const t = useT();
  const { toast } = useUi();
  const ledger = useLedger((s) => s.ledger);
  const groupId = useLedger((s) => s.groupId);
  const account = useLedger((s) => s.account);
  const claims = useLedger((s) => s.claims);
  const claim = useLedger((s) => s.claim);
  const registerSelf = useLedger((s) => s.registerSelf);
  const signIn = useLedger((s) => s.signIn);
  const [held, setHeld] = useState<PlayerClaim[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const signedIn = !!account && !account.anonymous;

  const refresh = useCallback(() => claims().then(setHeld, () => setHeld([])), [claims]);
  useEffect(() => {
    void refresh();
  }, [refresh, ledger.playerOrder.length]);

  const login = useCallback(async () => {
    try {
      await signIn(location.href);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [signIn, toast]);

  const pick = useCallback(
    async (playerId: PlayerId) => {
      if (!groupId) return;
      if (!signedIn) {
        setPendingClaim({ groupId, playerId });
        return login();
      }
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
    [groupId, signedIn, login, claim, toast, t, refresh],
  );

  const register = useCallback(
    async (newName: string) => {
      if (!groupId) return;
      if (!signedIn) {
        setPendingClaim({ groupId, name: newName });
        return login();
      }
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
    [groupId, signedIn, login, ledger.playerOrder.length, registerSelf, toast],
  );

  // Back from the sign-in redirect: finish what was picked before it.
  useEffect(() => {
    if (!signedIn || !groupId) return;
    const pending = takePendingClaim(groupId);
    if (!pending) return;
    if ('playerId' in pending) void pick(pending.playerId as PlayerId);
    else void register(pending.name);
  }, [signedIn, groupId, pick, register]);

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
        {!signedIn && (
          <div className="cm-form">
            <p className="cm-muted">{t('claim.loginHint')}</p>
            <button type="button" className="cm-button" onClick={() => void login()}>
              {t('account.login')}
            </button>
          </div>
        )}
        <button type="button" className="cm-button cm-button-ghost" onClick={onPeek}>
          {t('claim.peek')}
        </button>
      </div>
    </main>
  );
}

/**
 * Handles /join/:code: opens the group (a member continues as their player; anyone else lands on "who are
 * you?" with the option to watch), then hands back to the app.
 */
export function JoinScreen({ code, onDone }: { code: string; onDone: () => void }) {
  const t = useT();
  const openInvite = useLedger((s) => s.openInvite);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // A freshly opened link starts at "who are you?", even if this tab was watching before.
    setPeekGroup(null);
    openInvite(code).then(
      () => !cancelled && onDone(),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [code, openInvite, onDone]);
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

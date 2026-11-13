import { activePlayers, awaitingReceipt, ballotsFor, isSpectator, motionBallotsFor, outstanding, type EventId, type PlayerId } from '@coffee/core';
import { useState, type ReactNode } from 'react';
import { CheckInButton, useSettleAttendance, useWorkplaceWatch } from './Attendance';
import { BallotsSheet } from './BallotsSheet';
import { CalendarSheet } from './CalendarSheet';
import { useLedger, useT, useUi } from './context';
import { CorrectSheet } from './CorrectSheet';
import { LedgerSheet } from './LedgerSheet';
import { ClaimScreen } from './Claim';
import { FeedToasts } from './Feed';
import { Onboarding } from './Onboarding';
import { RecordSheet } from './RecordSheet';
import { RedeemSheet } from './RedeemSheet';
import { peekGroup, setPeekGroup } from './session';
import { SettingsSheet } from './SettingsSheet';
import { Toasts } from './Toasts';

type SheetState =
  | { kind: 'none' }
  | { kind: 'record'; playerId?: PlayerId }
  | { kind: 'ledger'; playerId: PlayerId; proposeFor?: EventId }
  | { kind: 'correct'; targetId: EventId; returnTo?: PlayerId }
  | { kind: 'ballots' }
  | { kind: 'redeem' }
  | { kind: 'calendar' }
  | { kind: 'settings' };

export interface SceneSlotProps {
  focusId: string | null;
  /** The redemption counter is open: frame the reaper's desk. */
  focusDesk: boolean;
  onSelectTower: (id: string | null) => void;
}

/**
 * The single screen: a scene (injected, so ui never depends on the 3D package) under a HUD and sheets.
 * Sheet routing lives here; each sheet owns its own form state.
 */
export function AppShell({ renderScene, onDemo }: { renderScene: (p: SceneSlotProps) => ReactNode; onDemo?: () => void }) {
  const t = useT();
  const status = useLedger((s) => s.status);
  const loadError = useLedger((s) => s.loadError);
  const groupId = useLedger((s) => s.groupId);
  const me = useLedger((s) => s.me);
  const ledger = useLedger((s) => s.ledger);
  const nowIso = useLedger((s) => s.nowIso);
  const sync = useLedger((s) => s.sync);
  const account = useLedger((s) => s.account);
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' });
  // Watching a group without a player of one's own (kept per tab, across the sign-in redirect).
  const [peeking, setPeeking] = useState(peekGroup);
  const close = () => setSheet({ kind: 'none' });
  useSettleAttendance();
  useWorkplaceWatch();
  const peek = (id: string | null) => {
    setPeekGroup(id);
    setPeeking(id);
  };

  if (status === 'idle' || status === 'loading') return <div className="cm-center">{t('app.loading')}</div>;
  if (status === 'error') return <div className="cm-center">{t('app.loadError', { message: loadError ?? '' })}</div>;
  if (!groupId) return <Onboarding {...(onDemo && { onDemo })} />;
  const viewer = !me;
  // Taking part needs Google: without it the group is only watched, with sign-in on offer (ViewerBar).
  const signedIn = !!account && !account.anonymous;
  if (viewer && signedIn && peeking !== groupId) return <ClaimScreen onPeek={() => peek(groupId)} />;

  const ballots = me
    ? ballotsFor(ledger, me, nowIso()).length + motionBallotsFor(ledger, me, nowIso()).length + awaitingReceipt(ledger, me).length
    : 0;
  const attendance = ledger.mode === 'attendance';
  const focusId = sheet.kind === 'ledger' ? sheet.playerId : null;
  const meName = me ? (ledger.players[me]?.name ?? '') : '';

  return (
    <>
      <div className="cm-stage">
        {renderScene({
          focusId,
          focusDesk: sheet.kind === 'redeem',
          onSelectTower: (id) => setSheet(id ? { kind: 'ledger', playerId: id as PlayerId } : { kind: 'none' }),
        })}
      </div>

      {/* The scene is a canvas; this is its equivalent for keyboard and screen-reader users. */}
      <nav className="cm-visually-hidden cm-focus-reveal" aria-label={t('hud.towers')}>
        <ul>
          {activePlayers(ledger).map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setSheet({ kind: 'ledger', playerId: p.id })}>
                {t(isSpectator(ledger, p.id) ? 'hud.towerSpectator' : 'hud.tower', { name: p.name, outstanding: outstanding(ledger, p.id) })}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="cm-hud">
        <div className="cm-hud-top">
          <h1 className="cm-pill">
            💀 {t('app.title')}
            {sync !== 'local' && (
              <span className={`cm-sync is-${sync}`} role="status" aria-label={t(`sync.${sync}`)} title={t(`sync.${sync}`)} />
            )}
          </h1>
          <div className="cm-row">
            <button
              type="button"
              className="cm-pill cm-pill-button"
              aria-label={t('calendar.open')}
              title={t('calendar.open')}
              onClick={() => setSheet({ kind: 'calendar' })}
            >
              📅 <span className="cm-hide-narrow">{t('calendar.open')}</span>
            </button>
            {!viewer && (
              <>
                <button type="button" className="cm-pill cm-pill-button" onClick={() => setSheet({ kind: 'ballots' })}>
                  ⚖️ {t('hud.ballots')}
                  {ballots > 0 && (
                    <span className="cm-count" aria-label={`${ballots}`}>
                      {ballots}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="cm-pill cm-pill-button"
                  aria-label={t('action.settings')}
                  title={t('hud.me', { name: meName })}
                  onClick={() => setSheet({ kind: 'settings' })}
                >
                  ⚙️ <span className="cm-hide-narrow">{meName}</span>
                </button>
              </>
            )}
          </div>
        </div>
        {viewer ? (
          <ViewerBar onStop={() => peek(null)} />
        ) : (
          <div className="cm-hud-bottom">
            {attendance ? (
              <CheckInButton />
            ) : (
              <button type="button" className="cm-button cm-button-primary cm-button-large" onClick={() => setSheet({ kind: 'record' })}>
                📜 {t('action.record')}
              </button>
            )}
            <button type="button" className="cm-button cm-button-large cm-button-secondary" onClick={() => setSheet({ kind: 'redeem' })}>
              🖋 {t('action.redeem')}
            </button>
          </div>
        )}
      </div>

      <RecordSheet
        open={sheet.kind === 'record'}
        onOpenChange={(o) => !o && close()}
        initialPlayerId={sheet.kind === 'record' ? (sheet.playerId ?? null) : null}
        onCorrectExisting={(targetId) => setSheet({ kind: 'correct', targetId })}
      />
      <LedgerSheet
        playerId={sheet.kind === 'ledger' ? sheet.playerId : null}
        proposeFor={sheet.kind === 'ledger' ? (sheet.proposeFor ?? null) : null}
        onOpenChange={(o) => !o && close()}
        onCorrect={(targetId) =>
          setSheet({ kind: 'correct', targetId, ...(sheet.kind === 'ledger' && { returnTo: sheet.playerId }) })
        }
        onOpenBallots={() => setSheet({ kind: 'ballots' })}
      />
      <CorrectSheet
        targetId={sheet.kind === 'correct' ? sheet.targetId : null}
        onOpenChange={(o) => {
          if (o) return;
          setSheet(sheet.kind === 'correct' && sheet.returnTo ? { kind: 'ledger', playerId: sheet.returnTo } : { kind: 'none' });
        }}
        onProposeWaive={(targetId) => {
          const rec = ledger.lates[targetId];
          setSheet(rec ? { kind: 'ledger', playerId: rec.playerId, proposeFor: targetId } : { kind: 'none' });
        }}
      />
      <BallotsSheet open={sheet.kind === 'ballots'} onOpenChange={(o) => !o && close()} />
      <RedeemSheet open={sheet.kind === 'redeem'} onOpenChange={(o) => !o && close()} />
      <CalendarSheet open={sheet.kind === 'calendar'} onOpenChange={(o) => !o && close()} />
      <SettingsSheet open={sheet.kind === 'settings'} onOpenChange={(o) => !o && close()} />
      <Toasts />
      <FeedToasts />
    </>
  );
}

/** Floating actions while watching: sign in (to continue as one's own player) or take part. */
function ViewerBar({ onStop }: { onStop: () => void }) {
  const t = useT();
  const { toast } = useUi();
  const account = useLedger((s) => s.account);
  const signIn = useLedger((s) => s.signIn);
  const closeGroup = useLedger((s) => s.closeGroup);
  const signedIn = !!account && !account.anonymous;
  return (
    <div className="cm-floating" role="region" aria-label={t('viewer.badge')}>
      <div className="cm-floating-text">
        <strong>{t('viewer.badge')}</strong>
        <span className="cm-muted">{signedIn ? t('viewer.joinHint') : t('viewer.loginHint')}</span>
      </div>
      <div className="cm-row">
        {signedIn ? (
          <button type="button" className="cm-button cm-button-primary" onClick={onStop}>
            {t('viewer.join')}
          </button>
        ) : (
          <button
            type="button"
            className="cm-button cm-button-primary"
            onClick={() => signIn(location.href).catch((e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error'))}
          >
            {t('account.login')}
          </button>
        )}
        <button
          type="button"
          className="cm-button cm-button-ghost"
          onClick={() => {
            onStop();
            void closeGroup();
          }}
        >
          {t('viewer.leave')}
        </button>
      </div>
    </div>
  );
}

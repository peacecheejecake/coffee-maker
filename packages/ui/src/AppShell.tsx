import { activePlayers, ballotsFor, outstanding, type EventId, type PlayerId } from '@coffee/core';
import { useState, type ReactNode } from 'react';
import { BallotsSheet } from './BallotsSheet';
import { useLedger, useT } from './context';
import { CorrectSheet } from './CorrectSheet';
import { LedgerSheet } from './LedgerSheet';
import { ClaimScreen } from './Claim';
import { FeedToasts } from './Feed';
import { Onboarding } from './Onboarding';
import { RecordSheet } from './RecordSheet';
import { SettingsSheet } from './SettingsSheet';
import { Toasts } from './Toasts';

type SheetState =
  | { kind: 'none' }
  | { kind: 'record'; playerId?: PlayerId }
  | { kind: 'ledger'; playerId: PlayerId; proposeFor?: EventId }
  | { kind: 'correct'; targetId: EventId; returnTo?: PlayerId }
  | { kind: 'ballots' }
  | { kind: 'settings' };

export interface SceneSlotProps {
  focusId: string | null;
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
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' });
  const close = () => setSheet({ kind: 'none' });

  if (status === 'idle' || status === 'loading') return <div className="cm-center">{t('app.loading')}</div>;
  if (status === 'error') return <div className="cm-center">{t('app.loadError', { message: loadError ?? '' })}</div>;
  if (!groupId) return <Onboarding {...(onDemo && { onDemo })} />;
  if (!me) return <ClaimScreen />;

  const ballots = ballotsFor(ledger, me, nowIso()).length;
  const focusId = sheet.kind === 'ledger' ? sheet.playerId : null;
  const meName = ledger.players[me]?.name ?? '';

  return (
    <>
      <div className="cm-stage">
        {renderScene({
          focusId,
          onSelectTower: (id) => setSheet(id ? { kind: 'ledger', playerId: id as PlayerId } : { kind: 'none' }),
        })}
      </div>

      {/* The scene is a canvas; this is its equivalent for keyboard and screen-reader users. */}
      <nav className="cm-visually-hidden cm-focus-reveal" aria-label={t('hud.towers')}>
        <ul>
          {activePlayers(ledger).map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setSheet({ kind: 'ledger', playerId: p.id })}>
                {t('hud.tower', { name: p.name, outstanding: outstanding(ledger, p.id) })}
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
          </div>
        </div>
        <div className="cm-hud-bottom">
          <button type="button" className="cm-button cm-button-primary cm-button-large" onClick={() => setSheet({ kind: 'record' })}>
            📜 {t('action.record')}
          </button>
        </div>
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
      <SettingsSheet open={sheet.kind === 'settings'} onOpenChange={(o) => !o && close()} />
      <Toasts />
      <FeedToasts />
    </>
  );
}

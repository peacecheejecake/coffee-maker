import { ranking } from '@coffee/core';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SceneSlotProps } from './AppShell';
import { useLedger, useT } from './context';
import { FeedToasts } from './Feed';
import { Toasts } from './Toasts';

const ROTATE_MS = 8_000;

/**
 * Office TV / kiosk dashboard (PLAN.md M7): no controls, a leaderboard, and the camera touring every tower
 * that owes something. Live updates still animate and toast.
 */
export function TvShell({ renderScene }: { renderScene: (p: SceneSlotProps) => ReactNode }) {
  const t = useT();
  const ledger = useLedger((s) => s.ledger);
  const groupId = useLedger((s) => s.groupId);
  const board = useMemo(() => ranking(ledger), [ledger]);
  const tour = useMemo(() => board.filter((r) => r.outstanding > 0).map((r) => r.player.id), [board]);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((s) => s + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  if (!groupId) return <div className="cm-center">{t('app.loading')}</div>;
  // Every other beat shows the whole room.
  const focusId = tour.length && step % 2 === 1 ? tour[Math.floor(step / 2) % tour.length]! : null;

  return (
    <>
      <div className="cm-stage">{renderScene({ focusId, focusDesk: false, onSelectTower: () => {} })}</div>
      <aside className="cm-tv-board" aria-label={t('hud.towers')}>
        <h1>💀 {t('app.title')}</h1>
        <ol>
          {board.map(({ player, outstanding }) => (
            <li key={player.id} className={player.id === focusId ? 'is-focus' : ''}>
              <span className="cm-dot" style={{ background: player.appearance.color }} aria-hidden />
              <span className="cm-tv-name">{player.name}</span>
              <span className="cm-tv-cups">☕ {outstanding}</span>
            </li>
          ))}
        </ol>
      </aside>
      <Toasts />
      <FeedToasts />
    </>
  );
}

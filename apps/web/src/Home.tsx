import { currentRuleset, toMinutes } from '@coffee/core';
import type { TimeOfDay } from '@coffee/scene';
import { AppShell, TvShell, useLedger, useUi, type SceneSlotProps } from '@coffee/ui';
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createDemoLedger } from './demo/demoLedger';
import { syncEnabled } from './config';
import { FONT_URL, fontFor } from './fonts';

/** Rigged reaper exported by scripts/blender/reaper.py (meshopt-compressed). */
const REAPER_MODEL_URL = '/models/reaper.glb';
import { toSceneModel } from './model/toSceneModel';
import { useSceneEvents } from './model/useSceneEvents';

// three.js + R3F are most of the bundle; the HUD and sheets work while the scene streams in.
const TowerScene = lazy(() => import('@coffee/scene').then((m) => ({ default: m.TowerScene })));

/**
 * The scene chunk failed to load (offline before it arrived, or a stale chunk after a deploy). Without
 * this the whole app unmounts; instead the HUD keeps working. Browsers remember a failed module fetch
 * for the life of the page, so getting the scene back takes a reload (the ledger is stored locally).
 */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function Home({ autoDemo = false }: { autoDemo?: boolean }) {
  const importGroup = useLedger((s) => s.importGroup);
  const sync = useLedger((s) => s.sync);
  const status = useLedger((s) => s.status);
  const groupId = useLedger((s) => s.groupId);
  const wallNow = useLedger((s) => s.wallNow);
  const startDemo = useCallback(() => {
    const demo = createDemoLedger(wallNow().workDate);
    void importGroup(demo.groupId, demo.me, demo.events);
  }, [importGroup, wallNow]);

  // /demo (or coffeemaker://demo): open straight into the demo ledger when this device has no group yet.
  const offerDemo = !syncEnabled && sync === 'local';
  useEffect(() => {
    if (autoDemo && offerDemo && status === 'ready' && !groupId) startDemo();
  }, [autoDemo, offerDemo, status, groupId, startDemo]);

  // The demo is a local-only sandbox; in a synced app it would be pushed to the server.
  return <AppShell {...(!syncEnabled && sync === 'local' && { onDemo: startDemo })} renderScene={(p) => <SceneView {...p} />} />;
}

/** Office TV: same scene and live feed, no controls (open /tv on the screen's browser). */
export function TvHome() {
  return <TvShell renderScene={(p) => <SceneView {...p} />} />;
}

function SceneView({ focusId, focusDesk, onSelectTower }: SceneSlotProps) {
  const ledger = useLedger((s) => s.ledger);
  const events = useLedger((s) => s.events);
  const groupId = useLedger((s) => s.groupId);
  const wallNow = useLedger((s) => s.wallNow);
  const today = wallNow().workDate;
  const model = useMemo(
    () => ({ ...toSceneModel(ledger, today, focusId), focusDesk }),
    [ledger, today, focusId, focusDesk],
  );
  const { queue, consume } = useSceneEvents(groupId, ledger, events);
  const [animating, setAnimating] = useState(false);
  const [reaperReady, setReaperReady] = useState(false);
  const markReaperReady = useCallback(() => setReaperReady(true), []);
  const { sfx, t } = useUi();
  const minutes = toMinutes(wallNow().hhmm);
  const start = toMinutes(currentRuleset(ledger).defaultStartTime);
  const timeOfDay: TimeOfDay = minutes < 11 * 60 ? 'morning' : minutes < 17 * 60 ? 'day' : 'evening';
  const reaperLines = useMemo(
    () => (['reaper.1', 'reaper.2', 'reaper.3', 'reaper.4', 'reaper.5', 'reaper.6'] as const).map((k) => t(k)),
    [t],
  );
  return (
    <div className="cm-stage" aria-busy={animating} data-testid="scene" data-reaper-ready={reaperReady}>
      <SceneBoundary
        fallback={
          <div className="scene-loading scene-failed">
            <button type="button" className="cm-button" onClick={() => window.location.reload()}>
              {t('scene.reload')}
            </button>
          </div>
        }
      >
        <Suspense fallback={<div className="scene-loading" aria-hidden />}>
          <TowerScene
            model={model}
            fontUrl={FONT_URL}
            onSelectTower={onSelectTower}
            events={queue}
            onEventsConsumed={consume}
            onAnimatingChange={setAnimating}
            onSfx={sfx}
            timeOfDay={timeOfDay}
            rollCall={minutes >= start - 10 && minutes < start}
            reaperLines={reaperLines}
            resolveFont={fontFor}
            reaperModelUrl={REAPER_MODEL_URL}
            onReaperReady={markReaperReady}
          />
        </Suspense>
      </SceneBoundary>
    </div>
  );
}

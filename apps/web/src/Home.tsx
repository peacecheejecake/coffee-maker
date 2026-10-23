import { currentRuleset, toMinutes } from '@coffee/core';
import type { TimeOfDay } from '@coffee/scene';
import { AppShell, TvShell, useLedger, useUi, type SceneSlotProps } from '@coffee/ui';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { createDemoLedger } from './demo/demoLedger';
import { syncEnabled } from './config';
import { FONT_URL, fontFor } from './fonts';
import { toSceneModel } from './model/toSceneModel';
import { useSceneEvents } from './model/useSceneEvents';

// three.js + R3F are most of the bundle; the HUD and sheets work while the scene streams in.
const TowerScene = lazy(() => import('@coffee/scene').then((m) => ({ default: m.TowerScene })));

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
  const { sfx, t } = useUi();
  const minutes = toMinutes(wallNow().hhmm);
  const start = toMinutes(currentRuleset(ledger).defaultStartTime);
  const timeOfDay: TimeOfDay = minutes < 11 * 60 ? 'morning' : minutes < 17 * 60 ? 'day' : 'evening';
  const reaperLines = useMemo(
    () => (['reaper.1', 'reaper.2', 'reaper.3', 'reaper.4', 'reaper.5', 'reaper.6'] as const).map((k) => t(k)),
    [t],
  );
  return (
    <div className="cm-stage" aria-busy={animating} data-testid="scene">
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
        />
      </Suspense>
    </div>
  );
}

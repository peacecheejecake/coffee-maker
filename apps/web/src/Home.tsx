import { TowerScene } from '@coffee/scene';
import { AppShell, useLedger, type SceneSlotProps } from '@coffee/ui';
import { useCallback, useMemo, useState } from 'react';
import { createDemoLedger } from './demo/demoLedger';
import { syncEnabled } from './config';
import { FONT_URL } from './fonts';
import { toSceneModel } from './model/toSceneModel';
import { useSceneEvents } from './model/useSceneEvents';

export function Home() {
  const importGroup = useLedger((s) => s.importGroup);
  const sync = useLedger((s) => s.sync);
  const wallNow = useLedger((s) => s.wallNow);
  const startDemo = useCallback(() => {
    const demo = createDemoLedger(wallNow().workDate);
    void importGroup(demo.groupId, demo.me, demo.events);
  }, [importGroup, wallNow]);

  // The demo is a local-only sandbox; in a synced app it would be pushed to the server.
  return <AppShell {...(!syncEnabled && sync === 'local' && { onDemo: startDemo })} renderScene={(p) => <SceneView {...p} />} />;
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
  return (
    <div className="cm-stage" aria-busy={animating} data-testid="scene">
      <TowerScene
        model={model}
        fontUrl={FONT_URL}
        onSelectTower={onSelectTower}
        events={queue}
        onEventsConsumed={consume}
        onAnimatingChange={setAnimating}
      />
    </div>
  );
}

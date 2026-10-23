import { TowerScene } from '@coffee/scene';
import { AppShell, useLedger, type SceneSlotProps } from '@coffee/ui';
import { useCallback, useMemo } from 'react';
import { createDemoLedger } from './demo/demoLedger';
import { FONT_URL } from './fonts';
import { toSceneModel } from './model/toSceneModel';

export function Home() {
  const importGroup = useLedger((s) => s.importGroup);
  const wallNow = useLedger((s) => s.wallNow);
  const startDemo = useCallback(() => {
    const demo = createDemoLedger(wallNow().workDate);
    void importGroup(demo.groupId, demo.me, demo.events);
  }, [importGroup, wallNow]);

  return <AppShell onDemo={startDemo} renderScene={(p) => <SceneView {...p} />} />;
}

function SceneView({ focusId, onSelectTower }: SceneSlotProps) {
  const ledger = useLedger((s) => s.ledger);
  const wallNow = useLedger((s) => s.wallNow);
  const today = wallNow().workDate;
  const model = useMemo(() => toSceneModel(ledger, today, focusId), [ledger, today, focusId]);
  return <TowerScene model={model} fontUrl={FONT_URL} onSelectTower={onSelectTower} />;
}

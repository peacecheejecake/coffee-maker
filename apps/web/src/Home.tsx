import { TowerScene } from '@coffee/scene';
import { useMemo, useState } from 'react';
import { createDemoLedger } from './demo/demoLedger';
import { FONT_URL } from './fonts';
import { toSceneModel } from './model/toSceneModel';

const TODAY = '2026-10-23';

export function Home() {
  const ledger = useMemo(() => createDemoLedger(TODAY), []);
  // ?focus=<playerId> deep-links straight to a tower.
  const [focusId, setFocusId] = useState<string | null>(() => new URLSearchParams(location.search).get('focus'));
  const model = useMemo(() => toSceneModel(ledger, TODAY, focusId), [ledger, focusId]);
  const focused = model.towers.find((t) => t.id === focusId);

  return (
    <>
      <div className="stage">
        <TowerScene model={model} fontUrl={FONT_URL} onSelectTower={setFocusId} />
      </div>
      <div className="hud">
        <h1 className="hud-title">💀 저승 커피 채권관리공사</h1>
        {focused && (
          <div className="focus-card">
            <strong>{focused.name}</strong>
            미상환 {focused.cups.length}잔 · 등급 {focused.grade}
          </div>
        )}
      </div>
    </>
  );
}

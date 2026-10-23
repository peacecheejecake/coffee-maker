import { RenderProbe, TowerScene, type CupAgeStage, type RenderStats, type SceneModel } from '@coffee/scene';
import { Leva, useControls } from 'leva';
import { useMemo, useState } from 'react';
import { PLAYER_COLORS } from '../demo/demoLedger';
import { FONT_URL } from '../fonts';

const NAMES = ['지원', '민수', '하나', '준호', '서연', '태민', '가람', '도윤', '예린', '시우', '채원', '하준', '은비', '건우', '소율', '우진', '다인', '현서', '이든', '나래'];
const AGES: CupAgeStage[] = ['fresh', 'cobweb', 'ghost', 'rip'];
const grade = (n: number) => (n === 0 ? 'AAA' : n <= 2 ? 'A' : n <= 5 ? 'B' : n <= 9 ? 'C' : 'D');

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** Initial control values can come from the URL (e2e screenshots): ?players=8&maxCups=40&uniform=1&seed=3&profile=1&hud=0 */
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
const flag = (k: string) => params.get(k) === '1';

/** Dev-only page: drive the scene with synthetic data and watch render cost. */
export function Sandbox() {
  const c = useControls({
    players: { value: num('players', 6), min: 1, max: 20, step: 1 },
    maxCups: { value: num('maxCups', 12), min: 0, max: 60, step: 1 },
    uniformCups: flag('uniform'),
    seed: { value: num('seed', 1), min: 1, max: 999, step: 1 },
    longNames: flag('longNames'),
    profile: { value: flag('profile'), label: 'frameloop=always' },
  });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [stats, setStats] = useState<RenderStats | null>(null);

  const model: SceneModel = useMemo(() => {
    const rnd = rng(c.seed);
    const counts = Array.from({ length: c.players }, () => (c.uniformCups ? c.maxCups : Math.floor(rnd() * (c.maxCups + 1))));
    const top = Math.max(0, ...counts);
    return {
      focusId,
      towers: counts.map((n, i) => ({
        id: `s${i}`,
        name: c.longNames ? `${NAMES[i % NAMES.length]}${'바보'.repeat(3)}` : NAMES[i % NAMES.length]!,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length]!,
        grade: grade(n),
        cups: Array.from({ length: n }, (_, k) => ({ id: `s${i}-${k}`, age: AGES[Math.floor(rnd() * AGES.length)]! })),
        receivedCount: 0,
        crowned: top > 0 && n === top,
      })),
    };
  }, [c.players, c.maxCups, c.uniformCups, c.seed, c.longNames, focusId]);

  const totalCups = model.towers.reduce((n, t) => n + t.cups.length, 0);

  return (
    <>
      <Leva hidden={params.get('hud') === '0'} />
      <div className="stage">
        <TowerScene
          model={model}
          fontUrl={FONT_URL}
          onSelectTower={setFocusId}
          frameloop={c.profile ? 'always' : 'demand'}
        >
          {c.profile && <RenderProbe onSample={setStats} />}
        </TowerScene>
      </div>
      <div className="probe" data-testid="probe">
        towers {model.towers.length} · cups {totalCups}
        {stats && ` · ${stats.fps} fps · ${stats.drawCalls} calls · ${(stats.triangles / 1000).toFixed(0)}k tris`}
        {focusId && ` · focus ${focusId}`}
      </div>
    </>
  );
}

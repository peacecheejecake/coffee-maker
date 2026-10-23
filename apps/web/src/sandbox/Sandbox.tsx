import {
  RenderProbe,
  TowerScene,
  type CupAgeStage,
  type Grade,
  type RenderStats,
  type SceneEvent,
  type SceneModel,
  type TowerView,
} from '@coffee/scene';
import { button, Leva, useControls } from 'leva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PLAYER_COLORS } from '../demo/demoLedger';
import { FONT_URL } from '../fonts';

const NAMES = ['지원', '민수', '하나', '준호', '서연', '태민', '가람', '도윤', '예린', '시우', '채원', '하준', '은비', '건우', '소율', '우진', '다인', '현서', '이든', '나래'];
const AGES: CupAgeStage[] = ['fresh', 'cobweb', 'ghost', 'rip'];
const grade = (n: number): Grade => (n === 0 ? 'AAA' : n <= 2 ? 'A' : n <= 5 ? 'B' : n <= 9 ? 'C' : 'D');

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

let nextId = 0;
const uid = (p: string) => `${p}${++nextId}`;

/** Dev-only page: drive the scene with synthetic data, trigger every animation, watch render cost. */
export function Sandbox() {
  const c = useControls({
    players: { value: num('players', 6), min: 1, max: 20, step: 1 },
    maxCups: { value: num('maxCups', 12), min: 0, max: 60, step: 1 },
    uniformCups: flag('uniform'),
    seed: { value: num('seed', 1), min: 1, max: 999, step: 1 },
    longNames: flag('longNames'),
    profile: { value: flag('profile'), label: 'frameloop=always' },
    speed: { value: 1, min: 0.1, max: 3, step: 0.1 },
    reducedMotion: flag('reduced'),
  });

  const initial = useMemo(() => {
    const rnd = rng(c.seed);
    return Array.from({ length: c.players }, (_, i) => {
      const n = c.uniformCups ? c.maxCups : Math.floor(rnd() * (c.maxCups + 1));
      return Array.from({ length: n }, (_, k) => ({ id: `s${i}-${k}`, age: AGES[Math.floor(rnd() * AGES.length)]! }));
    });
  }, [c.players, c.maxCups, c.uniformCups, c.seed]);

  const [cups, setCups] = useState(initial);
  useEffect(() => setCups(initial), [initial]);
  const [events, setEvents] = useState<SceneEvent[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [animating, setAnimating] = useState(false);

  const model: SceneModel = useMemo(() => {
    const top = Math.max(0, ...cups.map((x) => x.length));
    return {
      focusId,
      towers: cups.map(
        (list, i): TowerView => ({
          id: `s${i}`,
          name: c.longNames ? `${NAMES[i % NAMES.length]}${'바보'.repeat(3)}` : NAMES[i % NAMES.length]!,
          color: PLAYER_COLORS[i % PLAYER_COLORS.length]!,
          grade: grade(list.length),
          cups: list,
          receivedCount: 0,
          crowned: top > 0 && list.length === top,
          ballot: null,
        }),
      ),
    };
  }, [cups, c.longNames, focusId]);

  // Triggers mutate the cups and enqueue the matching scene events, like the real ledger mapping does.
  const cupsRef = useRef(cups);
  cupsRef.current = cups;
  const pick = () => Math.floor(Math.random() * cupsRef.current.length);
  const add = useCallback((count: number, tower = pick()) => {
    const ids = Array.from({ length: count }, () => uid('n'));
    const before = cupsRef.current[tower]!.length;
    setCups((all) => all.map((list, i) => (i === tower ? [...list, ...ids.map((id) => ({ id, age: 'fresh' as const }))] : list)));
    const ev: SceneEvent[] = [{ id: uid('ev'), kind: 'cupsAdded', towerId: `s${tower}`, cupIds: ids }];
    if (grade(before) !== grade(before + count)) ev.push({ id: uid('ev'), kind: 'gradeChanged', towerId: `s${tower}`, from: grade(before), to: grade(before + count) });
    setEvents((q) => [...q, ...ev]);
  }, []);
  const remove = useCallback((style: 'evaporate' | 'gold') => {
    const tower = cupsRef.current.findIndex((l) => l.length > 0);
    if (tower < 0) return;
    const list = cupsRef.current[tower]!;
    const gone = list.slice(-Math.min(2, list.length)).map((x) => x.id);
    setCups((all) => all.map((l, i) => (i === tower ? l.filter((x) => !gone.includes(x.id)) : l)));
    setEvents((q) => [...q, { id: uid('ev'), kind: 'cupsRemoved', towerId: `s${tower}`, cupIds: gone, style }]);
  }, []);

  useControls('animations', {
    'late +1': button(() => add(1)),
    'late +3': button(() => add(3)),
    'retract (evaporate)': button(() => remove('evaporate')),
    'waive approved (gold)': button(() => remove('gold')),
    'on time': button(() => setEvents((q) => [...q, { id: uid('ev'), kind: 'onTime', towerId: `s${pick()}` }])),
    'waive rejected': button(() => setEvents((q) => [...q, { id: uid('ev'), kind: 'verdict', towerId: `s${pick()}`, outcome: 'rejected' }])),
    'rules changed': button(() => setEvents((q) => [...q, { id: uid('ev'), kind: 'rulesChanged' }])),
    'sync burst (6)': button(() => {
      for (let i = 0; i < 6; i++) add(1);
    }),
  });

  const consume = useCallback((ids: string[]) => setEvents((q) => q.filter((e) => !ids.includes(e.id))), []);
  const totalCups = model.towers.reduce((n, t) => n + t.cups.length, 0);

  return (
    <>
      <Leva hidden={params.get('hud') === '0'} />
      <div className="stage" aria-busy={animating}>
        <TowerScene
          model={model}
          fontUrl={FONT_URL}
          onSelectTower={setFocusId}
          events={events}
          onEventsConsumed={consume}
          onAnimatingChange={setAnimating}
          reducedMotion={c.reducedMotion}
          timeScale={c.speed}
          frameloop={c.profile ? 'always' : 'demand'}
        >
          {c.profile && <RenderProbe onSample={setStats} />}
        </TowerScene>
      </div>
      <div className="probe" data-testid="probe">
        towers {model.towers.length} · cups {totalCups}
        {stats && ` · ${stats.fps} fps · ${stats.drawCalls} calls · ${(stats.triangles / 1000).toFixed(0)}k tris`}
        {focusId && ` · focus ${focusId}`}
        {animating && ' · ▶'}
      </div>
    </>
  );
}

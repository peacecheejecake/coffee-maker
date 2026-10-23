import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { timelineFor, type DirectorEnv, type FxContext } from '../src/director/director';
import { createFx } from '../src/director/fx';
import { TimelineRun } from '../src/director/timeline';
import type { SceneEvent } from '../src/model';

const env: DirectorEnv = {
  towerTop: () => [0, 5, 0],
  towerBase: () => [0, 0, 0],
  cupTarget: (id) => new Matrix4().makeTranslation(1, Number(id.replace(/\D/g, '')) || 1, 0),
  cupLastSeen: () => new Matrix4().makeTranslation(2, 3, 0),
  towerColor: () => '#f00',
  deskOut: [0, 2, -2],
  sfx: () => {},
};

const names = (e: SceneEvent, opts = {}) => timelineFor(e, opts).cues.map((c) => c.name);

/** Plays a whole timeline to the end against a fresh FX state. */
function play(e: SceneEvent, opts = {}) {
  const fx = createFx();
  const { cues, duration } = timelineFor(e, opts);
  const run = new TimelineRun<FxContext>(cues, duration);
  const ctx = { fx, env };
  for (let t = 0; t <= duration + 0.05; t += 0.05) {
    fx.now = t;
    run.advance(t, ctx);
  }
  return { fx, duration };
}

describe('director', () => {
  const added: SceneEvent = { id: 'e1', kind: 'cupsAdded', towerId: 'T', cupIds: ['c1', 'c2'] };

  it('a late record: focus, stamp, bill → drop per cup (staggered), unfocus', () => {
    expect(names(added)).toEqual(['focus', 'reaper:stamp', 'bill', 'bill', 'drop', 'drop', 'unfocus']);
    const cues = timelineFor(added).cues;
    const bills = cues.filter((c) => c.name === 'bill');
    expect(bills[1]!.at - bills[0]!.at).toBeCloseTo(0.15);
  });

  it('cups land at the end, with squash and a tower impact, and the camera is released', () => {
    const { fx } = play(added);
    expect([...fx.landed]).toEqual(['c1', 'c2']);
    expect(fx.landings.has('c2')).toBe(true);
    expect(fx.impacts.has('T')).toBe(true);
    expect(fx.flyers.size).toBe(0);
    expect(fx.focus).toBeNull();
    expect(fx.bursts.map((b) => b.kind)).toEqual(expect.arrayContaining(['smoke', 'splash']));
  });

  it('compact mode drops the camera and reaper flourish', () => {
    expect(names(added, { compact: true })).toEqual(['bill', 'bill', 'drop', 'drop']);
  });

  it('reduced motion just makes cups appear', () => {
    expect(names(added, { reduced: true })).toEqual(['appear']);
    expect([...play(added, { reduced: true }).fx.landed]).toEqual(['c1', 'c2']);
  });

  it('waived cups turn gold under the gavel; retracted ones evaporate', () => {
    const gold: SceneEvent = { id: 'e2', kind: 'cupsRemoved', towerId: 'T', cupIds: ['c1'], style: 'gold' };
    expect(names(gold)).toEqual(['focus', 'reaper:gavel', 'leave:gold', 'unfocus']);
    const { fx } = play(gold);
    expect(fx.removalStarted.has('c1')).toBe(true);
    expect(fx.leaving.size).toBe(0);
    expect(fx.bursts.some((b) => b.kind === 'gold')).toBe(true);
    const gone: SceneEvent = { id: 'e3', kind: 'cupsRemoved', towerId: 'T', cupIds: ['c1'], style: 'evaporate' };
    expect(names(gone)).toContain('leave:evaporate');
  });

  it('on-time, grade flips, rejections and rule changes', () => {
    expect(names({ id: 'a', kind: 'onTime', towerId: 'T' })).toEqual(['reaper:pen', 'sparkle']);
    expect(names({ id: 'b', kind: 'gradeChanged', towerId: 'T', from: 'A', to: 'B' })).toEqual(['flip']);
    expect(names({ id: 'c', kind: 'verdict', towerId: 'T', outcome: 'rejected' })).toEqual([
      'focus',
      'reaper:stamp',
      'stamp-burst',
      'unfocus',
    ]);
    expect(names({ id: 'd', kind: 'verdict', towerId: 'T', outcome: 'approved' })).toEqual([]);
    expect(names({ id: 'e', kind: 'rulesChanged' })).toEqual(['reaper:stamp']);
  });

  it('redeemed cups ascend to their recipient and leave a gold burst there', () => {
    const ascend: SceneEvent = { id: 'r', kind: 'cupsRemoved', towerId: 'T', cupIds: ['c1'], style: 'ascend', to: { c1: 'U' } };
    expect(names(ascend)).toEqual(['focus', 'reaper:stamp', 'leave:ascend', 'unfocus']);
    const fx = createFx();
    const { cues, duration } = timelineFor(ascend);
    const run = new TimelineRun<FxContext>(cues, duration);
    let sawTarget = false;
    for (let t = 0; t <= duration + 0.05; t += 0.05) {
      fx.now = t;
      run.advance(t, { fx, env });
      if (fx.leaving.get('c1')?.to) sawTarget = true;
    }
    expect(sawTarget).toBe(true);
    expect(fx.bursts.some((b) => b.kind === 'gold')).toBe(true);
  });

  it('paying off tears the statement and throws petals; inspect and nod are reaper moves', () => {
    expect(names({ id: 'p', kind: 'paidOff', towerId: 'T' })).toEqual(['focus', 'reaper:tear', 'petals', 'unfocus']);
    expect(names({ id: 'i', kind: 'inspect', towerId: 'T' })).toEqual(['reaper:inspect']);
    expect(names({ id: 'n', kind: 'acknowledged', towerId: 'T' })).toEqual(['reaper:nod']);
  });
});

import { asPlayerId } from '@coffee/core';
import { describe, expect, it } from 'vitest';
import { createDemoLedger } from '../src/demo/demoLedger';
import { toSceneModel } from '../src/model/toSceneModel';

describe('toSceneModel', () => {
  const state = createDemoLedger('2026-10-23');

  it('maps every active player to a tower in join order', () => {
    const m = toSceneModel(state, '2026-10-23');
    expect(m.towers.map((t) => [t.name, t.cups.length, t.grade])).toEqual([
      ['지원', 0, 'AAA'],
      ['민수', 7, 'C'],
      ['하나', 3, 'B'],
      ['준호', 12, 'D'],
      ['서연', 1, 'A'],
      ['태민', 34, 'D'],
    ]);
  });

  it('crowns the biggest debtor and ages cups by issue date', () => {
    const m = toSceneModel(state, '2026-10-23');
    expect(m.towers.filter((t) => t.crowned).map((t) => t.name)).toEqual(['태민']);
    const taemin = m.towers.find((t) => t.name === '태민')!;
    expect(taemin.cups[0]!.age).toBe('rip'); // 2026-06-01
    expect(taemin.cups.at(-1)!.age).toBe('fresh');
  });

  it('keeps focus only for existing towers', () => {
    expect(toSceneModel(state, '2026-10-23', 'p2').focusId).toBe('p2');
    expect(toSceneModel(state, '2026-10-23', 'nope').focusId).toBeNull();
  });

  it('hides archived players', () => {
    const archived = {
      ...state,
      players: { ...state.players, [asPlayerId('p1')]: { ...state.players[asPlayerId('p1')]!, archived: true } },
    };
    expect(toSceneModel(archived, '2026-10-23').towers.map((t) => t.name)).not.toContain('지원');
  });
});

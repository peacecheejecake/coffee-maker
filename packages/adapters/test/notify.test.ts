import { describe, expect, it } from 'vitest';
import { playerNames, pushMessage, pushTargets } from '../../../supabase/functions/notify/message';

describe('push notification rules', () => {
  const late = { type: 'LateRecorded', actor_id: 'A', body: { playerId: 'B', cups: 2 } };

  it('targets the affected players, never the actor', () => {
    expect(pushTargets(late)).toEqual(['B']);
    expect(pushTargets({ type: 'LateRecorded', actor_id: 'B', body: { playerId: 'B', cups: 1 } })).toEqual([]);
    expect(pushTargets({ type: 'WaiveProposed', actor_id: 'B', body: { voters: ['B', 'C', 'D'] } })).toEqual(['C', 'D']);
    expect(pushTargets({ type: 'CupsRedeemed', actor_id: 'B', body: { recipients: ['A', 'C', 'A'] } })).toEqual(['A', 'C']);
    expect(pushTargets({ type: 'RulesetChanged', actor_id: 'A', body: {} })).toEqual([]);
  });

  it('writes Korean messages with names and tags', () => {
    const names = (id: string) => ({ A: '지원', B: '민수' })[id] ?? '?';
    expect(pushMessage(late, names)).toMatchObject({ body: '지원님이 업보 2잔을 청구했습니다 ☕', tag: 'late:B' });
    expect(pushMessage({ type: 'CupsRedeemed', actor_id: 'B', body: { id: 'r1', payerId: 'B', count: 1 } }, names)?.body).toBe(
      '민수님이 커피 1잔을 샀습니다. 받으셨나요?',
    );
    expect(pushMessage({ type: 'PlayerJoined', actor_id: 'A', body: {} }, names)).toBeNull();
  });

  it('resolves current names from player events', () => {
    const names = playerNames([
      { type: 'PlayerJoined', body: { player: { id: 'A', name: '지원' } } },
      { type: 'PlayerUpdated', body: { playerId: 'A', patch: { name: '지원2' } } },
    ]);
    expect(names.get('A')).toBe('지원2');
  });
});

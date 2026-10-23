// Pure notification rules, shared by the Edge Function and its unit tests (no Deno or npm imports here).

export interface EventRecord {
  type: string;
  actor_id: string;
  body: Record<string, unknown>;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag: string;
  url: string;
}

const TITLE = '저승 커피 채권관리공사';

/** Which players should hear about this event (never the actor themselves). */
export function pushTargets(e: EventRecord): string[] {
  const b = e.body;
  let targets: string[] = [];
  switch (e.type) {
    case 'LateRecorded':
      targets = [String(b.playerId)];
      break;
    case 'WaiveProposed':
      targets = (b.voters as string[] | undefined) ?? [];
      break;
    case 'CupsRedeemed':
      targets = (b.recipients as string[] | undefined) ?? [];
      break;
  }
  return [...new Set(targets)].filter((p) => p && p !== e.actor_id);
}

export function pushMessage(e: EventRecord, nameOf: (playerId: string) => string): PushMessage | null {
  const b = e.body;
  switch (e.type) {
    case 'LateRecorded':
      return {
        title: TITLE,
        body: `${nameOf(e.actor_id)}님이 업보 ${Number(b.cups)}잔을 청구했습니다 ☕`,
        tag: `late:${String(b.playerId)}`,
        url: '/',
      };
    case 'WaiveProposed':
      return { title: TITLE, body: `탕감 심의가 열렸습니다. 투표해 주세요 ⚖️`, tag: `waive:${String(b.id)}`, url: '/' };
    case 'CupsRedeemed':
      return {
        title: TITLE,
        body: `${nameOf(String(b.payerId))}님이 커피 ${Number(b.count)}잔을 샀습니다. 받으셨나요?`,
        tag: `redeem:${String(b.id)}`,
        url: '/',
      };
    default:
      return null;
  }
}

/** Player id → current name, from the group's PlayerJoined/PlayerUpdated events in order. */
export function playerNames(events: { type: string; body: Record<string, unknown> }[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'PlayerJoined') {
      const p = e.body.player as { id: string; name: string };
      names.set(p.id, p.name);
    } else if (e.type === 'PlayerUpdated') {
      const patch = e.body.patch as { name?: string };
      if (patch.name) names.set(String(e.body.playerId), patch.name);
    }
  }
  return names;
}

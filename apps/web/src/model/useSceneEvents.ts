import type { GroupId, LedgerEvent, LedgerState } from '@coffee/core';
import type { SceneEvent } from '@coffee/scene';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toSceneEvents } from './sceneEvents';

interface Tracker {
  groupId: GroupId | null;
  ledger: LedgerState | null;
  seen: Set<string>;
  queue: SceneEvent[];
}

/**
 * Turns ledger changes into a queue of scene events. Derived during render (not in an effect) so the
 * frame that first shows a new cup already knows to hide it until its drop lands.
 * Loading a group or switching groups sets a new baseline instead of animating everything.
 */
export function useSceneEvents(groupId: GroupId | null, ledger: LedgerState, events: readonly LedgerEvent[]) {
  const tracker = useRef<Tracker>({ groupId: null, ledger: null, seen: new Set(), queue: [] });
  const [, rerender] = useState(0);

  // Runs during render; only does work when the ledger object changes.
  useMemo(() => {
    const tr = tracker.current;
    if (tr.ledger === ledger) return;
    const baseline = tr.groupId !== groupId || !tr.ledger || tr.ledger.playerOrder.length === 0;
    const fresh = events.filter((e) => !tr.seen.has(e.id));
    if (!baseline && fresh.length > 0) tr.queue = [...tr.queue, ...toSceneEvents(tr.ledger!, ledger, fresh)];
    if (baseline) tr.queue = [];
    tr.groupId = groupId;
    tr.ledger = ledger;
    tr.seen = new Set(events.map((e) => e.id));
  }, [groupId, ledger, events]);

  const consume = useCallback((ids: string[]) => {
    const done = new Set(ids);
    tracker.current.queue = tracker.current.queue.filter((e) => !done.has(e.id));
    rerender((x) => x + 1);
  }, []);

  return { queue: tracker.current.queue, consume };
}

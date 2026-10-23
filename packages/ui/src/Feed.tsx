import type { LedgerEvent, LedgerState } from '@coffee/core';
import type { Translate } from '@coffee/theme';
import { useEffect } from 'react';
import { useLedger, useStoreApi, useT, useUi } from './context';

/** Turns other devices' events and server rejections into toasts. */
export function FeedToasts() {
  const t = useT();
  const { toast } = useUi();
  const api = useStoreApi();
  const feedCount = useLedger((s) => s.remoteFeed.length);
  const rejectionCount = useLedger((s) => s.rejections.length);

  useEffect(() => {
    if (feedCount === 0) return;
    const { ledger } = api.getState();
    for (const e of api.getState().drainRemoteFeed()) {
      const message = describe(e, ledger, t);
      if (message) toast(message);
    }
  }, [feedCount, api, t, toast]);

  useEffect(() => {
    if (rejectionCount === 0) return;
    for (const r of api.getState().drainRejections()) {
      const key = `rejected.${r.reason}` as const;
      const known = key === 'rejected.proposal_expired' || key === 'rejected.already_voted' || key === 'rejected.retract_window_closed';
      toast(known ? t(key) : t('rejected.other', { reason: r.reason }), 'error');
    }
  }, [rejectionCount, api, t, toast]);

  return null;
}

function describe(e: LedgerEvent, s: LedgerState, t: Translate): string | null {
  const name = (id: string) => s.players[id as keyof typeof s.players]?.name ?? '?';
  switch (e.type) {
    case 'LateRecorded':
      return t('feed.LateRecorded', { actor: name(e.actorId), player: name(e.playerId), cups: e.cups });
    case 'WaiveProposed': {
      const rec = s.lates[e.targetId];
      return t('feed.WaiveProposed', { actor: name(e.actorId), player: rec ? name(rec.playerId) : '?' });
    }
    case 'RulesetChanged':
      return t('feed.RulesetChanged', { actor: name(e.actorId) });
    case 'PlayerJoined':
      return t('feed.PlayerJoined', { player: e.player.name });
    case 'CupsRedeemed':
      return t('feed.CupsRedeemed', { payer: name(e.payerId), debtor: name(e.debtorId), count: e.count });
    default:
      return null;
  }
}

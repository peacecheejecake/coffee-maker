import type { LedgerEvent, LedgerState } from '@coffee/core';
import { formatWorkDate } from './format';
import { motionTitle } from './Motions';
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
      // Settling missed days runs in the background; a refused copy (another device was first, or the day
      // is not over by the server clock) is retried later and is nothing the user did.
      if (r.event.type === 'AttendanceMissed') continue;
      const key = `rejected.${r.reason}` as const;
      const known =
        key === 'rejected.proposal_expired' ||
        key === 'rejected.already_voted' ||
        key === 'rejected.retract_window_closed' ||
        key === 'rejected.not_claimed' ||
        key === 'rejected.already_checked_in';
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
    case 'ModeChanged':
      return t('feed.ModeChanged', { mode: t(`mode.${e.mode}`) });
    case 'OwnerTransferred':
      return t('feed.OwnerTransferred', { player: name(e.to) });
    case 'MotionProposed':
      return t('feed.MotionProposed', { actor: name(e.actorId), title: motionTitle(t, s, e.motion) });
    case 'AttendanceMissed': {
      const rec = s.lates[e.id];
      return rec ? t('feed.AttendanceMissed', { player: name(e.playerId), date: formatWorkDate(e.workDate), cups: rec.cups }) : null;
    }
    default:
      return null;
  }
}

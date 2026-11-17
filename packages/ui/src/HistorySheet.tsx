import { currentRuleset, type LedgerEvent, type LedgerState, type Motion, type PlayerId, type ProposalStatus } from '@coffee/core';
import type { MessageKey, Translate } from '@coffee/theme';
import { useMemo, useState } from 'react';
import { useLedger, useT } from './context';
import { formatInstant, formatWorkDate } from './format';
import { motionTitle } from './Motions';
import { Sheet } from './primitives';

export const HISTORY_TAGS = ['checkin', 'charge', 'review', 'waive', 'schedule', 'redeem', 'rules', 'roster'] as const;
export type HistoryTag = (typeof HISTORY_TAGS)[number];

export interface HistoryEntry {
  id: string;
  at: string;
  /** An entry shows under every filter it carries (a forgiveness motion is both a review and a waiver). */
  tags: HistoryTag[];
  text: string;
  /** Where a proposal stands now; votes are folded into this instead of listed. */
  status?: ProposalStatus;
}

/** The group's whole story, newest first, from the event log. Votes, receipts and claims are left out. */
export function historyEntries(events: readonly LedgerEvent[], s: LedgerState, t: Translate): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const e of events) {
    const entry = describe(e, s, t);
    if (entry) out.push({ id: e.id, at: e.serverAt ?? e.at, ...entry });
  }
  return out.reverse();
}

function describe(e: LedgerEvent, s: LedgerState, t: Translate): Omit<HistoryEntry, 'id' | 'at'> | null {
  const name = (id: PlayerId | undefined) => (id && s.players[id]?.name) || '?';
  const late = (targetId: LedgerEvent['id']) => s.lates[targetId];
  switch (e.type) {
    case 'CheckedIn':
      return { tags: ['checkin'], text: t('history.CheckedIn', { player: name(e.actorId), date: formatWorkDate(e.workDate) }) };
    case 'ArrivalOnTime':
      return {
        tags: ['checkin'],
        text: t('history.ArrivalOnTime', { player: name(e.playerId), date: formatWorkDate(e.workDate), at: e.arrivedAt }),
      };
    case 'AttendanceMissed': {
      const rec = late(e.id);
      if (!rec) return null;
      return {
        tags: ['checkin', 'charge'],
        text: t('feed.AttendanceMissed', { player: name(e.playerId), date: formatWorkDate(e.workDate), cups: rec.cups }),
      };
    }
    case 'LateRecorded':
      return { tags: ['charge'], text: t('feed.LateRecorded', { actor: name(e.actorId), player: name(e.playerId), cups: e.cups }) };
    case 'LateCorrected':
    case 'LateRetracted': {
      const rec = late(e.targetId);
      if (!rec) return null;
      const key: MessageKey = e.type === 'LateCorrected' ? 'history.LateCorrected' : 'history.LateRetracted';
      return { tags: ['charge'], text: t(key, { actor: name(e.actorId), player: name(rec.playerId), date: formatWorkDate(rec.workDate) }) };
    }
    case 'WaiveProposed': {
      const p = s.proposals[e.id];
      if (!p) return null;
      return {
        tags: ['review', 'waive'],
        text: t('feed.WaiveProposed', { actor: name(e.actorId), player: name(p.debtorId) }),
        status: p.status,
      };
    }
    case 'MotionProposed': {
      const m = s.motions[e.id];
      if (!m) return null;
      return {
        tags: ['review', ...motionTags(m.motion)],
        text: t('feed.MotionProposed', { actor: name(e.actorId), title: motionTitle(t, s, m.motion) }),
        status: m.status,
      };
    }
    // A withdrawal gets its own line (when and by whom); the proposal above it also wears the 철회 badge.
    case 'WaiveWithdrawn': {
      const p = s.proposals[e.proposalId];
      if (!p || p.status !== 'withdrawn') return null;
      return { tags: ['review', 'waive'], text: t('history.WaiveWithdrawn', { actor: name(e.actorId), player: name(p.debtorId) }) };
    }
    case 'MotionWithdrawn': {
      const m = s.motions[e.motionId];
      if (!m || m.status !== 'withdrawn') return null;
      return {
        tags: ['review', ...motionTags(m.motion)],
        text: t('history.MotionWithdrawn', { actor: name(e.actorId), title: motionTitle(t, s, m.motion) }),
      };
    }
    case 'CupsRedeemed':
      return { tags: ['redeem'], text: t('feed.CupsRedeemed', { payer: name(e.payerId), debtor: name(e.debtorId), count: e.count }) };
    case 'RedemptionReverted':
      return { tags: ['redeem'], text: t('history.RedemptionReverted', { actor: name(e.actorId) }) };
    case 'HolidaySet':
      return {
        tags: ['schedule'],
        text: e.off
          ? t('history.HolidaySet', { date: formatWorkDate(e.date), name: e.name })
          : t('history.HolidayCleared', { date: formatWorkDate(e.date) }),
      };
    case 'VacationSet':
      return {
        tags: ['schedule'],
        text: t(e.on ? 'history.VacationSet' : 'history.VacationCleared', { player: name(e.actorId), date: formatWorkDate(e.date) }),
      };
    case 'RulesAdopted':
      return { tags: ['rules'], text: t('history.RulesAdopted', { actor: name(e.actorId) }) };
    case 'RulesetChanged':
      return { tags: ['rules'], text: t('feed.RulesetChanged', { actor: name(e.actorId) }) };
    case 'ModeChanged':
      return { tags: ['rules'], text: t('feed.ModeChanged', { mode: t(`mode.${e.mode}`) }) };
    case 'PlayerJoined':
      return { tags: ['roster'], text: t('feed.PlayerJoined', { player: e.player.name }) };
    case 'PlayerUpdated':
      // Name and color edits are housekeeping; only leaving or coming back belongs in the story.
      if (e.patch.archived === undefined) return null;
      return { tags: ['roster'], text: t(e.patch.archived ? 'history.Archived' : 'history.Unarchived', { player: name(e.playerId) }) };
    case 'OwnerTransferred':
      return { tags: ['roster'], text: t('feed.OwnerTransferred', { player: name(e.to) }) };
    default:
      return null;
  }
}

function motionTags(m: Motion): HistoryTag[] {
  switch (m.kind) {
    case 'ruleset':
      return ['rules'];
    case 'holiday':
      return ['schedule'];
    case 'adjust':
      return [m.delta < 0 ? 'waive' : 'charge'];
    case 'redeem':
      return ['redeem'];
    case 'spectate':
      return m.forgive ? ['roster', 'waive'] : ['roster'];
  }
}

const STATUS_BADGE: Record<ProposalStatus, string> = {
  open: 'cm-badge cm-badge-review',
  approved: 'cm-badge cm-badge-ok',
  rejected: 'cm-badge',
  withdrawn: 'cm-badge',
  expired: 'cm-badge',
  void: 'cm-badge',
};

/** One page shown at a time, so a long-running group stays quick to open. */
const PAGE = 100;

export function HistorySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('history.title')}>
      {open && <HistoryBody />}
    </Sheet>
  );
}

function HistoryBody() {
  const t = useT();
  const events = useLedger((s) => s.events);
  const ledger = useLedger((s) => s.ledger);
  const tz = currentRuleset(ledger).timezone;
  // Nothing picked means everything, like the "전체" chip says.
  const [picked, setPicked] = useState<HistoryTag[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const all = useMemo(() => historyEntries(events, ledger, t), [events, ledger, t]);
  const shown = picked.length === 0 ? all : all.filter((e) => e.tags.some((tag) => picked.includes(tag)));
  const toggle = (tag: HistoryTag) => {
    setPicked((p) => (p.includes(tag) ? p.filter((x) => x !== tag) : [...p, tag]));
    setLimit(PAGE);
  };

  return (
    <div className="cm-stack">
      <fieldset className="cm-chips">
        <legend className="cm-field-label">{t('history.filter')}</legend>
        <button type="button" className="cm-chip" aria-pressed={picked.length === 0} onClick={() => setPicked([])}>
          {t('history.all')}
        </button>
        {HISTORY_TAGS.map((tag) => (
          <button key={tag} type="button" className="cm-chip" aria-pressed={picked.includes(tag)} onClick={() => toggle(tag)}>
            {t(`history.tag.${tag}`)}
          </button>
        ))}
      </fieldset>
      {shown.length === 0 ? (
        <p className="cm-muted">{t('history.empty')}</p>
      ) : (
        <ol className="cm-list cm-history-list" aria-label={t('history.title')}>
          {shown.slice(0, limit).map((e) => (
            <li key={e.id} className="cm-history-item">
              <time className="cm-history-at" dateTime={e.at}>
                {formatInstant(e.at, tz)}
              </time>
              <span className="cm-history-text">{e.text}</span>
              {e.status && <span className={STATUS_BADGE[e.status]}>{t(`history.status.${e.status}`)}</span>}
            </li>
          ))}
        </ol>
      )}
      {shown.length > limit && (
        <button type="button" className="cm-button cm-button-ghost" onClick={() => setLimit((l) => l + PAGE)}>
          {t('history.more', { count: shown.length - limit })}
        </button>
      )}
    </div>
  );
}

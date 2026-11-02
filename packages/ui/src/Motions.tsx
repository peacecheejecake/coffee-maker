import {
  isPolygonArea,
  isSoloMember,
  MAX_CUPS_PER_RECORD,
  motionStatus,
  outstanding,
  type LedgerState,
  type Motion,
  type MotionRecord,
  type PlayerId,
  type Ruleset,
} from '@coffee/core';
import type { Translate } from '@coffee/theme';
import { useState } from 'react';
import { useCommand, useLedger, useStoreApi, useT, useUi } from './context';
import { formatWorkDate } from './format';
import { Field, Stepper } from './primitives';

const rulesetSummary = (t: Translate, rs: Ruleset): string =>
  [
    rs.defaultStartTime,
    `+${rs.graceMinutes}′`,
    rs.cupRule.mode === 'fixed'
      ? `☕×${rs.cupRule.cups}`
      : rs.cupRule.tiers.map((tier) => `${tier.upToMinutes ?? '∞'}′:${tier.cups}`).join(' '),
    `${rs.waivePolicy.ttlHours}h`,
    // Coordinates mean little to voters; the label and the size (radius, or vertex count) are what they recognize.
    rs.workplace
      ? `📍${rs.workplace.label ? `${rs.workplace.label} ` : ''}${
          isPolygonArea(rs.workplace) ? t('workplace.polygonShort', { count: rs.workplace.points.length }) : `${rs.workplace.radiusMeters}m`
        }`
      : '📍–',
  ].join(' · ');

export function motionTitle(t: Translate, s: LedgerState, m: Motion): string {
  const name = (id: PlayerId) => s.players[id]?.name ?? '?';
  switch (m.kind) {
    case 'ruleset':
      return t('motion.ruleset', { summary: rulesetSummary(t, m.ruleset) });
    case 'holiday':
      return m.off
        ? t('motion.holiday', { date: formatWorkDate(m.date), name: m.name })
        : t('motion.holidayOff', { date: formatWorkDate(m.date) });
    case 'adjust':
      return m.delta > 0
        ? t('motion.adjustAdd', { player: name(m.playerId), count: m.delta })
        : t('motion.adjustRemove', { player: name(m.playerId), count: -m.delta });
    case 'redeem':
      return t('motion.redeem', { debtor: name(m.debtorId), recipients: m.recipients.map(name).join(', ') });
  }
}

/** Toast after proposing: either it passed on the spot or it waits for `n` approvals. */
export function useMotionFeedback() {
  const t = useT();
  const { toast } = useUi();
  const api = useStoreApi();
  return (motionId: string | undefined) => {
    const m = motionId ? api.getState().ledger.motions[motionId as MotionRecord['id']] : undefined;
    if (!m) return;
    if (m.status === 'approved') toast(t('motion.passedNow'));
    else toast(t('motion.proposed', { count: m.voters.filter((v) => m.votes[v] !== 'approve').length }));
  };
}

export function MotionCard({ motion: m, now }: { motion: MotionRecord; now: string }) {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const api = useStoreApi();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const [confirmReject, setConfirmReject] = useState(false);
  const yes = m.voters.filter((v) => m.votes[v] === 'approve').length;
  const hours = Math.max(0, Math.ceil((Date.parse(m.expiresAt) - Date.parse(now)) / 3_600_000));
  const canVote = !!me && m.voters.includes(me) && m.votes[me] === undefined && motionStatus(m, now) === 'open';

  async function vote(v: 'approve' | 'reject') {
    const d = await run({ type: 'VoteMotion', motionId: m.id, vote: v });
    if (!d.ok) return;
    const status = api.getState().ledger.motions[m.id]?.status;
    toast(status === 'approved' ? t('motion.approved') : status === 'rejected' ? t('motion.rejected') : t('motion.voted'));
  }

  return (
    <li className="cm-ballot">
      <p className="cm-ballot-title">{motionTitle(t, ledger, m.motion)}</p>
      {m.motion.kind === 'adjust' && <p className="cm-ballot-reason">“{m.motion.reason}”</p>}
      <p className="cm-muted">
        {t('motion.proposer', { name: ledger.players[m.proposerId]?.name ?? '?' })} · {t('waive.remaining', { hours })}
      </p>
      <div className="cm-votes" aria-label={t('waive.progress', { yes, total: m.voters.length })}>
        {m.voters.map((v) => (
          <span
            key={v}
            className={`cm-vote ${m.votes[v] === 'approve' ? 'is-yes' : m.votes[v] === 'reject' ? 'is-no' : ''}`}
            title={ledger.players[v]?.name}
          />
        ))}
        <span className="cm-muted">{t('waive.progress', { yes, total: m.voters.length })}</span>
      </div>
      {canVote &&
        (confirmReject ? (
          <div className="cm-warning" role="alert">
            <p>{t('motion.rejectConfirm')}</p>
            <div className="cm-row">
              <button type="button" className="cm-button cm-button-danger" onClick={() => void vote('reject')}>
                {t('motion.reject')}
              </button>
              <button type="button" className="cm-button cm-button-ghost" onClick={() => setConfirmReject(false)}>
                {t('action.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="cm-row">
            <button type="button" className="cm-button cm-button-primary" onClick={() => void vote('approve')}>
              {t('motion.approve')}
            </button>
            <button type="button" className="cm-button" onClick={() => setConfirmReject(true)}>
              {t('motion.reject')}
            </button>
          </div>
        ))}
      {me === m.proposerId && (
        <button type="button" className="cm-button cm-button-ghost" onClick={() => void run({ type: 'WithdrawMotion', motionId: m.id })}>
          {t('motion.withdraw')}
        </button>
      )}
    </li>
  );
}

/** Proposes adding or removing cups for one player, independent of any date (both modes). */
export function AdjustForm({ playerId, onDone }: { playerId: PlayerId; onDone: () => void }) {
  const t = useT();
  const run = useCommand();
  const feedback = useMotionFeedback();
  const owed = useLedger((s) => outstanding(s.ledger, playerId));
  const solo = useLedger((s) => isSoloMember(s.ledger, s.me));
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState('');
  return (
    <form
      className="cm-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const d = await run({ type: 'ProposeMotion', motion: { kind: 'adjust', playerId, delta, reason } });
        if (!d.ok) return;
        feedback(d.value[0]?.id);
        onDone();
      }}
    >
      <p className="cm-muted">{t(solo ? 'adjust.hintSolo' : 'adjust.hint')}</p>
      <Stepper
        label={t('adjust.delta')}
        value={delta}
        min={-Math.min(owed, MAX_CUPS_PER_RECORD)}
        max={MAX_CUPS_PER_RECORD}
        // Zero is no change; skip over it.
        onChange={(v) => setDelta(v !== 0 ? v : delta > 0 && owed > 0 ? -1 : 1)}
      />
      <Field label={t('adjust.reason')}>
        <input className="cm-input" required maxLength={80} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <button type="submit" className="cm-button cm-button-primary" disabled={!reason.trim() || delta === 0}>
        {t(solo ? 'adjust.submitSolo' : 'adjust.submit')}
      </button>
    </form>
  );
}

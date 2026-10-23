import {
  lateRecordsOf,
  minutesBetween,
  openProposal,
  playerStats,
  RETRACT_WINDOW_MINUTES,
  type CorrectionEntry,
  type EventId,
  type LateRecord,
  type LedgerState,
  type PlayerId,
  type Redemption,
  redemptionsOf,
} from '@coffee/core';
import type { MessageKey, Translate } from '@coffee/theme';
import { useMemo, useState } from 'react';
import { useCommand, useLedger, useT, useUi } from './context';
import { formatInstant, formatWorkDate } from './format';
import { sealDataUrl, seedOf } from './stamp';
import { Sheet } from './primitives';

interface LedgerSheetProps {
  playerId: PlayerId | null;
  onOpenChange: (open: boolean) => void;
  onCorrect: (id: EventId) => void;
  onOpenBallots: () => void;
  /** Record whose waive form should be open when the sheet appears (e.g. coming from a zero-cup correction). */
  proposeFor?: EventId | null;
}

export function LedgerSheet(props: LedgerSheetProps) {
  const t = useT();
  const player = useLedger((s) => (props.playerId ? s.ledger.players[props.playerId] : undefined));
  return (
    <Sheet
      open={props.playerId !== null}
      onOpenChange={props.onOpenChange}
      title={player ? t('ledger.title', { name: player.name }) : ''}
    >
      {props.playerId && <LedgerBody key={props.playerId} {...props} playerId={props.playerId} />}
    </Sheet>
  );
}

function LedgerBody({ playerId, onCorrect, onOpenBallots, proposeFor }: LedgerSheetProps & { playerId: PlayerId }) {
  const t = useT();
  const ledger = useLedger((s) => s.ledger);
  const stats = playerStats(ledger, playerId);
  const records = [...lateRecordsOf(ledger, playerId)].sort(
    (a, b) => b.workDate.localeCompare(a.workDate) || b.recordedAt.localeCompare(a.recordedAt),
  );

  return (
    <div className="cm-stack">
      <p className="cm-summary">
        {t('ledger.summary', {
          outstanding: stats.outstanding,
          grade: stats.grade,
          title: t(`grade.${stats.grade}`),
        })}
        {stats.overpaid > 0 && <span className="cm-muted"> · {t('ledger.overpaid', { count: stats.overpaid })}</span>}
      </p>
      <RedemptionList playerId={playerId} />
      {records.length === 0 ? (
        <p className="cm-muted">{t('ledger.empty')}</p>
      ) : (
        <ul className="cm-list">
          {records.map((r) => (
            <RecordRow
              key={r.id}
              record={r}
              onCorrect={onCorrect}
              onOpenBallots={onOpenBallots}
              initiallyProposing={proposeFor === r.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordRow({
  record: r,
  onCorrect,
  onOpenBallots,
  initiallyProposing,
}: {
  record: LateRecord;
  onCorrect: (id: EventId) => void;
  onOpenBallots: () => void;
  initiallyProposing: boolean;
}) {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const nowIso = useLedger((s) => s.nowIso);
  const [expanded, setExpanded] = useState(initiallyProposing);
  const [proposing, setProposing] = useState(initiallyProposing);
  const [reason, setReason] = useState('');

  const now = nowIso();
  const review = openProposal(ledger, r.id, now);
  const active = r.status === 'active';
  const canRetract = active && r.recordedBy === me && minutesBetween(r.recordedAt, now) <= RETRACT_WINDOW_MINUTES;

  async function propose() {
    const d = await run({ type: 'ProposeWaive', targetId: r.id, reason });
    if (d.ok) {
      toast(t('waive.proposed'));
      setProposing(false);
    }
  }

  return (
    <li className={`cm-record ${active ? '' : 'is-closed'}`}>
      <button type="button" className="cm-record-head" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
        <span>
          {t('ledger.row', { date: formatWorkDate(r.workDate), arrived: r.arrivedAt, minutes: r.minutesLate })}
        </span>
        <span className="cm-record-badges">
          {r.status !== 'active' && <span className="cm-badge">{t(`ledger.status.${r.status}`)}</span>}
          {review && <span className="cm-badge cm-badge-review">{t('ledger.status.review')}</span>}
          {r.corrections.length > 0 && <span className="cm-badge">{t('ledger.corrected')}</span>}
          <span className="cm-cups">{t('ledger.cups', { cups: r.cups })}</span>
        </span>
      </button>

      {expanded && (
        <div className="cm-record-body">
          {r.note && <p>“{r.note}”</p>}
          <p className="cm-muted">
            {t('ledger.recordedBy', { by: nameOf(ledger, r.recordedBy) })} · {formatInstant(r.recordedAt)}
          </p>
          {r.corrections.length > 0 && (
            <div>
              <p className="cm-field-label">{t('ledger.history')}</p>
              <ul className="cm-history">
                {r.corrections.map((c) => (
                  <li key={c.eventId}>
                    {t('ledger.historyRow', { changes: describeCorrection(c, t), by: nameOf(ledger, c.actorId), at: formatInstant(c.at) })}
                    {c.reason && <span className="cm-muted"> — {c.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {active && (
            <div className="cm-row cm-wrap">
              <button type="button" className="cm-button" onClick={() => onCorrect(r.id)}>
                {t('ledger.correct')}
              </button>
              {canRetract && (
                <button type="button" className="cm-button" onClick={() => void run({ type: 'RetractLate', targetId: r.id })}>
                  {t('ledger.retract')}
                </button>
              )}
              {review ? (
                <button type="button" className="cm-button cm-button-ghost" onClick={onOpenBallots}>
                  {t('ledger.status.review')} →
                </button>
              ) : (
                <button type="button" className="cm-button cm-button-ghost" aria-expanded={proposing} onClick={() => setProposing((x) => !x)}>
                  {t('ledger.propose')}
                </button>
              )}
            </div>
          )}

          {active && proposing && !review && (
            <form
              className="cm-form cm-inset"
              onSubmit={(e) => {
                e.preventDefault();
                void propose();
              }}
            >
              <label className="cm-field">
                <span className="cm-field-label">{t('waive.reason')}</span>
                <input
                  className="cm-input"
                  required
                  autoFocus
                  maxLength={120}
                  placeholder={t('waive.reasonPlaceholder')}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button type="submit" className="cm-button cm-button-primary" disabled={!reason.trim()}>
                {t('waive.submit')}
              </button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

const nameOf = (s: LedgerState, id: PlayerId) => s.players[id]?.name ?? '?';

function describeCorrection(c: CorrectionEntry, t: Translate): string {
  const parts: string[] = [];
  const b = c.before;
  if (c.changes.arrivedAt !== undefined) parts.push(`${t('record.arrivedAt')} ${b.arrivedAt}→${c.changes.arrivedAt}`);
  if (c.changes.scheduledStart !== undefined) {
    parts.push(`${t('record.scheduledStart')} ${b.scheduledStart}→${c.changes.scheduledStart}`);
  }
  if (c.changes.cups !== undefined) parts.push(`☕ ${b.cups}→${c.changes.cups}`);
  if (c.changes.note !== undefined) parts.push(`${t('record.note')}: ${c.changes.note || '∅'}`);
  return parts.join(' · ') || t('ledger.corrected' satisfies MessageKey);
}

function RedemptionList({ playerId }: { playerId: PlayerId }) {
  const t = useT();
  const ledger = useLedger((s) => s.ledger);
  const list = [...redemptionsOf(ledger, playerId)].reverse();
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="redemptions-h">
      <p id="redemptions-h" className="cm-field-label">
        {t('ledger.redemptions')}
      </p>
      <ul className="cm-list">
        {list.map((r) => (
          <RedemptionRow key={r.id} redemption={r} />
        ))}
      </ul>
    </section>
  );
}

function RedemptionRow({ redemption: r }: { redemption: Redemption }) {
  const t = useT();
  const run = useCommand();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const nowIso = useLedger((s) => s.nowIso);
  const evidenceUrl = useLedger((s) => s.evidenceUrl);
  const [photo, setPhoto] = useState<string | null>(null);
  const acked = r.recipients.filter((id) => r.acknowledgedBy.includes(id)).length;
  const fully = acked === r.recipients.length;
  const seal = useMemo(() => sealDataUrl(r.stampQuality, seedOf(r.id), 96), [r.stampQuality, r.id]);
  const canRevert = !r.reverted && r.recordedBy === me && minutesBetween(r.at, nowIso()) <= RETRACT_WINDOW_MINUTES;

  return (
    <li className={`cm-record cm-redemption ${r.reverted ? 'is-closed' : ''}`}>
      <div className="cm-record-head">
        <span>
          {t('ledger.redemptionRow', {
            at: formatInstant(r.at),
            count: r.cupIds.length,
            recipients: r.recipients.map((id) => nameOf(ledger, id)).join(', '),
          })}
          {r.payerId !== r.debtorId && <span className="cm-muted"> · {t('ledger.paidBy', { name: nameOf(ledger, r.payerId) })}</span>}
        </span>
        {seal && (
          // Faint until every recipient confirms (DESIGN.md §3.3).
          <img src={seal} alt={t(`redeem.quality.${r.stampQuality}`)} className="cm-seal" style={{ opacity: fully ? 1 : 0.45 }} />
        )}
      </div>
      <div className="cm-record-body">
        <p className="cm-muted">
          {r.reverted ? t('ledger.reverted') : t('ledger.acks', { done: acked, total: r.recipients.length })}
        </p>
        <div className="cm-row cm-wrap">
          {r.evidence && !photo && (
            <button type="button" className="cm-button cm-button-ghost" onClick={async () => setPhoto(await evidenceUrl(r.evidence!.assetId))}>
              🧾 {t('ledger.evidence')}
            </button>
          )}
          {canRevert && (
            <button type="button" className="cm-button" onClick={() => void run({ type: 'RevertRedemption', redemptionId: r.id })}>
              {t('ledger.revert')}
            </button>
          )}
        </div>
        {photo && <img src={photo} alt={t('ledger.evidence')} className="cm-evidence" />}
      </div>
    </li>
  );
}

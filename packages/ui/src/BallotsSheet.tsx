import { awaitingReceipt, proposalStatus, type Redemption, type WaiveProposal } from '@coffee/core';
import { useState } from 'react';
import { useCommand, useLedger, useStoreApi, useT, useUi } from './context';
import { formatWorkDate } from './format';
import { Sheet } from './primitives';

export function BallotsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const now = useLedger((s) => s.nowIso)();
  const receipts = me ? awaitingReceipt(ledger, me) : [];
  const open_ = ledger.proposalOrder
    .map((id) => ledger.proposals[id])
    .filter((p): p is WaiveProposal => !!p && proposalStatus(p, now) === 'open');
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('waive.title')}>
      <div className="cm-stack">
        {receipts.length > 0 && (
          <section className="cm-section" aria-labelledby="receipts-h">
            <h3 id="receipts-h">{t('receipt.title')}</h3>
            <ul className="cm-list">
              {receipts.map((r) => (
                <ReceiptCard key={r.id} redemption={r} />
              ))}
            </ul>
          </section>
        )}
        {open_.length === 0 ? (
          <p className="cm-muted">{t('waive.empty')}</p>
        ) : (
          <ul className="cm-list">
            {open_.map((p) => (
              <BallotCard key={p.id} proposal={p} now={now} />
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

function BallotCard({ proposal: p, now }: { proposal: WaiveProposal; now: string }) {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const api = useStoreApi();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const [confirmReject, setConfirmReject] = useState(false);
  const rec = ledger.lates[p.targetId];
  const yes = p.voters.filter((v) => p.votes[v] === 'approve').length;
  const hours = Math.max(0, Math.ceil((Date.parse(p.expiresAt) - Date.parse(now)) / 3_600_000));
  const canVote = !!me && p.voters.includes(me) && p.votes[me] === undefined;

  async function vote(v: 'approve' | 'reject') {
    const d = await run({ type: 'VoteWaive', proposalId: p.id, vote: v });
    if (!d.ok) return;
    const status = api.getState().ledger.proposals[p.id]?.status;
    toast(status === 'approved' ? t('waive.approved') : status === 'rejected' ? t('waive.rejected') : t('waive.voted'));
  }

  return (
    <li className="cm-ballot">
      <p className="cm-ballot-title">
        {t('waive.card', {
          debtor: ledger.players[p.debtorId]?.name ?? '?',
          date: rec ? formatWorkDate(rec.workDate) : '',
          minutes: rec?.minutesLate ?? 0,
          cups: rec?.cups ?? 0,
        })}
      </p>
      <p className="cm-ballot-reason">“{p.reason}”</p>
      <p className="cm-muted">
        {t('waive.proposer', { name: ledger.players[p.proposerId]?.name ?? '?' })} · {t('waive.remaining', { hours })}
      </p>
      <div className="cm-votes" aria-label={t('waive.progress', { yes, total: p.voters.length })}>
        {p.voters.map((v) => (
          <span
            key={v}
            className={`cm-vote ${p.votes[v] === 'approve' ? 'is-yes' : p.votes[v] === 'reject' ? 'is-no' : ''}`}
            title={ledger.players[v]?.name}
          />
        ))}
        <span className="cm-muted">{t('waive.progress', { yes, total: p.voters.length })}</span>
      </div>

      {canVote &&
        (confirmReject ? (
          <div className="cm-warning" role="alert">
            <p>{t('waive.rejectConfirm')}</p>
            <div className="cm-row">
              <button type="button" className="cm-button cm-button-danger" onClick={() => void vote('reject')}>
                {t('waive.reject')}
              </button>
              <button type="button" className="cm-button cm-button-ghost" onClick={() => setConfirmReject(false)}>
                {t('action.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="cm-row">
            <button type="button" className="cm-button cm-button-primary" onClick={() => void vote('approve')}>
              {t('waive.approve')}
            </button>
            <button type="button" className="cm-button" onClick={() => setConfirmReject(true)}>
              {t('waive.reject')}
            </button>
          </div>
        ))}
      {me === p.proposerId && (
        <button type="button" className="cm-button cm-button-ghost" onClick={() => void run({ type: 'WithdrawWaive', proposalId: p.id })}>
          {t('action.undo')}
        </button>
      )}
    </li>
  );
}

function ReceiptCard({ redemption: r }: { redemption: Redemption }) {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const ledger = useLedger((s) => s.ledger);
  const name = (id: string) => ledger.players[id as keyof typeof ledger.players]?.name ?? '?';
  return (
    <li className="cm-ballot">
      <p>{t('receipt.card', { payer: name(r.payerId), debtor: name(r.debtorId), count: r.cupIds.length })}</p>
      <button
        type="button"
        className="cm-button cm-button-primary"
        onClick={async () => {
          const d = await run({ type: 'AcknowledgeRedemption', redemptionId: r.id });
          if (d.ok) toast(t('receipt.done'));
        }}
      >
        {t('receipt.confirm')}
      </button>
    </li>
  );
}

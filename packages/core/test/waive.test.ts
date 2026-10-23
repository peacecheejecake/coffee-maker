import { describe, expect, it } from 'vitest';
import {
  asEventId,
  ballotsFor,
  openProposal,
  proposalStatus,
  tallyWaive,
  type EventId,
  type LedgerEvent,
} from '../src';
import { A, B, C, D, E, createLedger, type Ledger } from './harness';

/** 4-player group; A (owner) is the debtor with one late record. */
function setup() {
  const l = createLedger();
  l.join(A, B, C, D);
  const target = l.late(A, '09:30', { by: B });
  return { l, target };
}

const propose = (l: Ledger, by: typeof A, targetId: EventId, reason = '지하철 고장') =>
  l.run(by, { type: 'ProposeWaive', targetId, reason })[0]!.id;

describe('tallyWaive (unanimous)', () => {
  const policy = { mode: 'unanimous' as const, ttlHours: 72 };
  it('needs every voter to approve; any reject rejects', () => {
    expect(tallyWaive(policy, [B, C], { [B]: 'approve' })).toBe('pending');
    expect(tallyWaive(policy, [B, C], { [B]: 'approve', [C]: 'approve' })).toBe('approved');
    expect(tallyWaive(policy, [B, C], { [C]: 'reject' })).toBe('rejected');
  });
});

describe('scenario 8 — waive votes', () => {
  it('B proposes (auto-approve) → C, D approve → approved, cups removed', () => {
    const { l, target } = setup();
    const events = l.run(B, { type: 'ProposeWaive', targetId: target, reason: '  지하철 고장 ' });
    expect(events.map((e) => e.type)).toEqual(['WaiveProposed', 'WaiveVoted']);
    const pid = events[0]!.id;
    const p = l.state.proposals[pid]!;
    expect(p).toMatchObject({ voters: [B, C, D], reason: '지하철 고장', expiresAt: '2026-10-26T00:00:00.000Z' });
    expect(p.votes).toEqual({ [B]: 'approve' });

    l.run(C, { type: 'VoteWaive', proposalId: pid, vote: 'approve' });
    expect(l.cups(A)).toBe(1);
    l.run(D, { type: 'VoteWaive', proposalId: pid, vote: 'approve' });

    expect(l.state.proposals[pid]?.status).toBe('approved');
    expect(l.state.lates[target]).toMatchObject({ status: 'waived' });
    expect(l.state.lates[target]?.openProposalId).toBeUndefined();
    expect(l.cups(A)).toBe(0);
  });

  it('a single reject closes it immediately; later votes are refused', () => {
    const { l, target } = setup();
    const pid = propose(l, B, target);
    l.run(C, { type: 'VoteWaive', proposalId: pid, vote: 'reject' });
    expect(l.state.proposals[pid]?.status).toBe('rejected');
    expect(l.fail(D, { type: 'VoteWaive', proposalId: pid, vote: 'approve' }).code).toBe('ProposalClosed');
    expect(l.cups(A)).toBe(1);
  });

  it('the debtor can propose but cannot vote', () => {
    const { l, target } = setup();
    const events = l.run(A, { type: 'ProposeWaive', targetId: target, reason: '병원' });
    expect(events).toHaveLength(1); // no auto-vote for the debtor
    const pid = events[0]!.id;
    expect(l.state.proposals[pid]?.voters).toEqual([B, C, D]);
    expect(l.fail(A, { type: 'VoteWaive', proposalId: pid, vote: 'approve' }).code).toBe('NotAVoter');
  });

  it('players who join after the proposal have no vote', () => {
    const { l, target } = setup();
    const pid = propose(l, B, target);
    l.join(E);
    expect(l.fail(E, { type: 'VoteWaive', proposalId: pid, vote: 'approve' }).code).toBe('NotAVoter');
    l.run(C, { type: 'VoteWaive', proposalId: pid, vote: 'approve' });
    l.run(D, { type: 'VoteWaive', proposalId: pid, vote: 'approve' });
    expect(l.state.proposals[pid]?.status).toBe('approved'); // E was never needed
  });

  it('archived players are not voters', () => {
    const { l, target } = setup();
    l.run(A, { type: 'UpdatePlayer', playerId: D, patch: { archived: true } });
    const pid = propose(l, B, target);
    expect(l.state.proposals[pid]?.voters).toEqual([B, C]);
  });

  it('votes cannot be changed', () => {
    const { l, target } = setup();
    const pid = propose(l, B, target);
    expect(l.fail(B, { type: 'VoteWaive', proposalId: pid, vote: 'reject' }).code).toBe('AlreadyVoted');
  });

  it('expires after the TTL', () => {
    const { l, target } = setup();
    const pid = propose(l, B, target);
    l.advanceMinutes(72 * 60 + 1);
    expect(proposalStatus(l.state.proposals[pid]!, l.now)).toBe('expired');
    expect(l.fail(C, { type: 'VoteWaive', proposalId: pid, vote: 'approve' }).code).toBe('ProposalClosed');
    expect(openProposal(l.state, target, l.now)).toBeUndefined();
    // Re-proposal is allowed once the old one has expired, and marks the old one expired.
    const pid2 = propose(l, C, target, '다시 심의 요청');
    expect(l.state.proposals[pid]?.status).toBe('expired');
    expect(l.state.lates[target]?.openProposalId).toBe(pid2);
  });

  it('one open proposal per record; re-proposal allowed after rejection', () => {
    const { l, target } = setup();
    const pid = propose(l, B, target);
    expect(l.fail(C, { type: 'ProposeWaive', targetId: target, reason: 'x' })).toMatchObject({
      code: 'ProposalAlreadyOpen',
      detail: { proposalId: pid },
    });
    l.run(C, { type: 'VoteWaive', proposalId: pid, vote: 'reject' });
    const pid2 = propose(l, C, target, '새 사유');
    expect(l.state.proposals[pid2]?.status).toBe('open');
  });

  it('withdrawal by the proposer only', () => {
    const { l, target } = setup();
    const pid = propose(l, B, target);
    expect(l.fail(C, { type: 'WithdrawWaive', proposalId: pid }).code).toBe('NotPermitted');
    l.run(B, { type: 'WithdrawWaive', proposalId: pid });
    expect(l.state.proposals[pid]?.status).toBe('withdrawn');
    expect(l.fail(C, { type: 'VoteWaive', proposalId: pid, vote: 'approve' }).code).toBe('ProposalClosed');
    expect(l.fail(B, { type: 'WithdrawWaive', proposalId: pid }).code).toBe('ProposalClosed');
    expect(l.fail(B, { type: 'WithdrawWaive', proposalId: asEventId('x') }).code).toBe('TargetNotFound');
  });

  it('needs at least one eligible voter and a reason', () => {
    const l = createLedger();
    l.join(A);
    const target = l.late(A);
    expect(l.fail(A, { type: 'ProposeWaive', targetId: target, reason: 'x' }).code).toBe('NoEligibleVoters');
    expect(l.fail(A, { type: 'ProposeWaive', targetId: target, reason: '   ' }).code).toBe('ReasonRequired');
    expect(l.fail(A, { type: 'ProposeWaive', targetId: asEventId('x'), reason: 'x' }).code).toBe('TargetNotFound');
    expect(l.fail(A, { type: 'VoteWaive', proposalId: asEventId('x'), vote: 'approve' }).code).toBe('TargetNotFound');
  });

  it('two-player group: the other player proposing approves at once', () => {
    const l = createLedger();
    l.join(A, B);
    const target = l.late(A);
    propose(l, B, target);
    expect(l.state.lates[target]?.status).toBe('waived');
    expect(l.fail(B, { type: 'ProposeWaive', targetId: target, reason: 'x' }).code).toBe('AlreadyClosed');
  });

  it('retracting a record voids its open proposal', () => {
    const { l, target } = setup();
    const pid = propose(l, C, target);
    l.run(B, { type: 'RetractLate', targetId: target });
    expect(l.state.proposals[pid]?.status).toBe('void');
  });

  it('lists pending ballots per voter', () => {
    const { l, target } = setup();
    const pid = propose(l, B, target);
    expect(ballotsFor(l.state, C, l.now).map((p) => p.id)).toEqual([pid]);
    expect(ballotsFor(l.state, B, l.now)).toEqual([]); // already voted
    expect(ballotsFor(l.state, A, l.now)).toEqual([]); // debtor
  });
});

describe('waive votes under sync races (evolve)', () => {
  it('ignores votes the server received after expiry', () => {
    const { l, target } = setup();
    const pid = propose(l, B, target);
    const [vote] = l.decideOnly(C, { type: 'VoteWaive', proposalId: pid, vote: 'approve' });
    l.apply({ ...vote!, serverAt: '2026-10-26T00:00:01.000Z' });
    expect(l.state.proposals[pid]).toMatchObject({ status: 'expired', votes: { [B]: 'approve' } });
  });

  it('ignores duplicate and non-voter ballots', () => {
    const { l, target } = setup();
    const pid = propose(l, B, target);
    const [vote] = l.decideOnly(C, { type: 'VoteWaive', proposalId: pid, vote: 'reject' });
    l.apply({ ...vote!, actorId: A }); // debtor
    l.apply({ ...vote!, actorId: B }); // already voted
    l.apply({ ...vote!, proposalId: asEventId('unknown') } as LedgerEvent);
    expect(l.state.proposals[pid]).toMatchObject({ status: 'open', votes: { [B]: 'approve' } });
  });

  it('a concurrent second proposal for the same record is ignored', () => {
    const { l, target } = setup();
    const [p1] = l.decideOnly(C, { type: 'ProposeWaive', targetId: target, reason: 'one' });
    const [p2] = l.decideOnly(D, { type: 'ProposeWaive', targetId: target, reason: 'two' });
    l.apply(p1!, p2!);
    expect(l.state.proposalOrder).toEqual([p1!.id]);
    l.apply({ ...p1! }); // replayed duplicate
    expect(l.state.proposalOrder).toEqual([p1!.id]);
  });

  it('ignores proposals with no voters or for closed records, and withdrawals by others', () => {
    const { l, target } = setup();
    const [p] = l.decideOnly(C, { type: 'ProposeWaive', targetId: target, reason: 'x' });
    l.apply({ ...p!, voters: [] } as typeof p & object);
    expect(l.state.proposalOrder).toEqual([]);
    l.apply(p!);
    const [w] = l.decideOnly(C, { type: 'WithdrawWaive', proposalId: p!.id });
    l.apply({ ...w!, actorId: D });
    expect(l.state.proposals[p!.id]?.status).toBe('open');
  });
});

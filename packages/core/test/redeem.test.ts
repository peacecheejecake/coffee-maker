import { describe, expect, it } from 'vitest';
import { asEventId, overpaid, playerStats, ranking, redemptionsOf } from '../src';
import { A, B, C, D, createLedger } from './harness';

describe('scenario 2 — redemption order', () => {
  it('newest first by default, oldest first on request', () => {
    const l = createLedger();
    l.join(A, B, C);
    const r1 = l.late(B, '09:10', { workDate: '2026-10-01' });
    const r2 = l.late(B, '09:10', { workDate: '2026-10-02' });
    const r3 = l.late(B, '09:10', { workDate: '2026-10-03' });

    l.run(B, { type: 'Redeem', debtorId: B, count: 1, recipients: [C], stampQuality: 'clean' });
    expect(l.state.towers[B]?.cups.map((c) => c.sourceId)).toEqual([r1, r2]);

    l.run(B, { type: 'Redeem', debtorId: B, count: 1, recipients: [C], order: 'oldest', stampQuality: 'faint' });
    expect(l.state.towers[B]?.cups.map((c) => c.sourceId)).toEqual([r2]);

    expect(l.state.lates[r3]?.redeemed).toBe(1);
    expect(l.state.towers[C]?.received.map((g) => g.cupId)).toEqual([`${r3}#1`, `${r1}#1`]);
  });
});

describe('scenario 3 — paying for someone else', () => {
  it('records payer separately from debtor', () => {
    const l = createLedger();
    l.join(A, B, C);
    l.late(B);
    const [e] = l.run(C, { type: 'Redeem', debtorId: B, count: 1, recipients: [A], stampQuality: 'clean' });
    expect(l.state.redemptions[e!.id]).toMatchObject({ debtorId: B, payerId: C, recordedBy: C });
    expect(l.state.towers[A]?.received[0]?.from).toBe(C);
    expect(playerStats(l.state, C).cleanStamps).toBe(1);
    expect(playerStats(l.state, B).cupsRedeemed).toBe(1);
  });

  it('explicit payer', () => {
    const l = createLedger();
    l.join(A, B, C);
    l.late(B);
    const [e] = l.run(A, { type: 'Redeem', debtorId: B, payerId: C, count: 1, recipients: [A], stampQuality: 'smudged' });
    expect(l.state.redemptions[e!.id]?.payerId).toBe(C);
  });
});

describe('treat-everyone distribution', () => {
  it('hands cups out round-robin; extra recipients get nothing', () => {
    const l = createLedger();
    l.join(A, B, C, D);
    l.late(B, '09:10', { cups: 3 });
    l.run(B, { type: 'Redeem', debtorId: B, count: 2, recipients: [A, C, D, A], stampQuality: 'clean' });
    expect(l.state.towers[A]?.received).toHaveLength(1);
    expect(l.state.towers[C]?.received).toHaveLength(1);
    expect(l.state.towers[D]?.received).toHaveLength(0);
    expect(l.cups(B)).toBe(1);
  });
});

describe('scenario 5 — overpayment', () => {
  it('waiving an already-paid record leaves an overpaid count', () => {
    const l = createLedger();
    l.join(A, B, C);
    const id = l.late(B, '09:10', { cups: 2 });
    l.run(B, { type: 'Redeem', debtorId: B, count: 2, recipients: [A], stampQuality: 'clean' });
    const pid = l.run(A, { type: 'ProposeWaive', targetId: id, reason: '오판' })[0]!.id;
    l.run(C, { type: 'VoteWaive', proposalId: pid, vote: 'approve' });
    expect(l.state.lates[id]?.status).toBe('waived');
    expect(overpaid(l.state, B)).toBe(2);
    expect(l.cups(B)).toBe(0);
  });

  it('correcting below what was paid never brings cups back', () => {
    const l = createLedger();
    l.join(A, B);
    const id = l.late(B, '09:10', { cups: 2 });
    l.run(B, { type: 'Redeem', debtorId: B, count: 2, recipients: [A], stampQuality: 'clean' });
    l.run(A, { type: 'CorrectLate', targetId: id, changes: { cups: 1 } });
    expect(overpaid(l.state, B)).toBe(1);
    l.run(A, { type: 'CorrectLate', targetId: id, changes: { cups: 2 } });
    expect(l.cups(B)).toBe(0);
    expect(overpaid(l.state, B)).toBe(0);
    l.run(A, { type: 'CorrectLate', targetId: id, changes: { cups: 3 } });
    expect(l.cups(B)).toBe(1);
    expect(l.state.towers[B]?.cups[0]?.id).toBe(`${id}#3`);
  });

  it('concurrent redemptions clamp and count the excess as overpaid', () => {
    const l = createLedger();
    l.join(A, B);
    l.late(B);
    const [r1] = l.decideOnly(B, { type: 'Redeem', debtorId: B, count: 1, recipients: [A], stampQuality: 'clean' });
    const [r2] = l.decideOnly(A, { type: 'Redeem', debtorId: B, count: 1, recipients: [A], stampQuality: 'clean' });
    l.apply(r1!, r2!);
    expect(l.cups(B)).toBe(0);
    expect(l.state.redemptions[r2!.id]?.cupIds).toEqual([]);
    expect(overpaid(l.state, B)).toBe(1);
  });
});

describe('redeem validation', () => {
  it('rejects bad requests', () => {
    const l = createLedger();
    l.join(A, B);
    const base = { type: 'Redeem' as const, debtorId: B, count: 1, recipients: [A], stampQuality: 'clean' as const };
    expect(l.fail(B, base).code).toBe('NothingToRedeem');
    l.late(B);
    expect(l.fail(B, { ...base, count: 2 })).toMatchObject({ code: 'RedeemExceedsDebt', detail: { outstanding: 1 } });
    expect(l.fail(B, { ...base, count: 0 }).code).toBe('InvalidInput');
    expect(l.fail(B, { ...base, recipients: [] }).code).toBe('InvalidInput');
    expect(l.fail(B, { ...base, recipients: [C] }).code).toBe('PlayerNotFound');
    expect(l.fail(B, { ...base, debtorId: C }).code).toBe('PlayerNotFound');
    expect(l.fail(B, { ...base, payerId: C }).code).toBe('PlayerNotFound');
  });

  it('evidence is kept', () => {
    const l = createLedger();
    l.join(A, B);
    l.late(B);
    const [e] = l.run(B, {
      type: 'Redeem',
      debtorId: B,
      count: 1,
      recipients: [A],
      stampQuality: 'clean',
      evidence: { assetId: 'img1' },
    });
    expect(redemptionsOf(l.state, B)[0]?.evidence).toEqual({ assetId: 'img1' });
    expect(l.state.redemptions[e!.id]?.order).toBe('newest');
  });
});

describe('acknowledgement', () => {
  it('only recipients acknowledge, once', () => {
    const l = createLedger();
    l.join(A, B, C);
    l.late(B);
    const [r] = l.run(B, { type: 'Redeem', debtorId: B, count: 1, recipients: [A], stampQuality: 'clean' });
    const id = r!.id;
    expect(l.fail(C, { type: 'AcknowledgeRedemption', redemptionId: id }).code).toBe('NotPermitted');
    l.run(A, { type: 'AcknowledgeRedemption', redemptionId: id });
    expect(l.state.redemptions[id]?.acknowledgedBy).toEqual([A]);
    expect(l.fail(A, { type: 'AcknowledgeRedemption', redemptionId: id }).code).toBe('NoChange');
    expect(l.fail(A, { type: 'AcknowledgeRedemption', redemptionId: asEventId('x') }).code).toBe('TargetNotFound');
  });
});

describe('full journey — record, correct, vote, redeem, pay off', () => {
  it('ends at AAA with stats consistent', () => {
    const l = createLedger();
    l.join(A, B, C);
    const r1 = l.late(B, '09:10', { workDate: '2026-10-20' });
    const r2 = l.late(B, '09:30', { workDate: '2026-10-21' });
    l.late(C, '09:05', { workDate: '2026-10-21' });
    l.run(A, { type: 'CorrectLate', targetId: r2, changes: { cups: 2 } });
    expect(ranking(l.state).map((r) => [r.player.id, r.outstanding])).toEqual([
      [B, 3],
      [C, 1],
      [A, 0],
    ]);
    expect(playerStats(l.state, B).grade).toBe('B');

    const pid = l.run(B, { type: 'ProposeWaive', targetId: r1, reason: '폭설' })[0]!.id;
    l.run(A, { type: 'VoteWaive', proposalId: pid, vote: 'approve' });
    l.run(C, { type: 'VoteWaive', proposalId: pid, vote: 'approve' });
    expect(l.cups(B)).toBe(2);

    l.run(B, { type: 'Redeem', debtorId: B, count: 1, recipients: [A], stampQuality: 'clean' });
    l.run(C, { type: 'Redeem', debtorId: B, count: 1, recipients: [A, C], stampQuality: 'faint' });

    expect(playerStats(l.state, B)).toEqual({
      outstanding: 0,
      grade: 'AAA',
      lateCount: 1,
      cupsRedeemed: 2,
      cleanStamps: 1,
      received: 0,
      overpaid: 0,
    });
    expect(playerStats(l.state, A).received).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, isSpectator, missedDays, type LedgerEvent } from '../src';
import { A, B, C, D, createLedger, type Ledger } from './harness';

/** Moves the clock and `today` together; the harness clock starts Fri 2026-10-23 09:00 KST. */
function at(l: Ledger, date: string, hhmm: string) {
  const target = Date.parse(`${date}T${hhmm}:00+09:00`);
  l.advanceMinutes((target - Date.parse(l.now)) / 60_000);
  l.setToday(date);
}

/** A (owner), B, C, D in attendance mode with rules adopted on Fri 10-23 (judged from Sat 10-24). */
function group() {
  const l = createLedger();
  l.join(A, B, C, D);
  l.claim(B, C, D);
  l.run(A, { type: 'ChangeMode', mode: 'attendance' });
  l.run(A, { type: 'AdoptRules', ruleset: DEFAULT_RULESET });
  return l;
}

const propose = (l: Ledger, by: typeof A, playerIds: (typeof A)[], spectator = true, forgive = false) =>
  l.run(by, { type: 'ProposeMotion', motion: { kind: 'spectate', playerIds, spectator, ...(forgive && { forgive }) } })[0]!;

const approve = (l: Ledger, by: typeof A, motionId: string) => l.run(by, { type: 'VoteMotion', motionId, vote: 'approve' });

/** Gives `player` cups the way attendance mode allows: an adjustment everyone else approves. */
function owe(l: Ledger, player: typeof A, cups: number) {
  const p = l.run(A, { type: 'ProposeMotion', motion: { kind: 'adjust', playerId: player, delta: cups, reason: '시험 적립' } })[0]!;
  for (const id of l.state.motions[p.id]!.voters) if (id !== A) approve(l, id, p.id);
}

describe('spectator motions (ADR 0004)', () => {
  it('moves several players at once when everyone but them approves', () => {
    const l = group();
    const p = propose(l, A, [C, D]);
    // The people being moved do not vote; the proposer's own approval is already in.
    expect(l.state.motions[p.id]?.voters).toEqual([A, B]);
    expect(isSpectator(l.state, C)).toBe(false);

    approve(l, B, p.id);
    expect(l.state.motions[p.id]?.status).toBe('approved');
    expect(isSpectator(l.state, C)).toBe(true);
    expect(isSpectator(l.state, D)).toBe(true);
    expect(isSpectator(l.state, B)).toBe(false);
  });

  it('one rejection stops it', () => {
    const l = group();
    const p = propose(l, A, [C]);
    l.run(B, { type: 'VoteMotion', motionId: p.id, vote: 'reject' });
    expect(l.state.motions[p.id]?.status).toBe('rejected');
    expect(isSpectator(l.state, C)).toBe(false);
  });

  it('keeps the cups they owe unless the motion forgives them', () => {
    const l = group();
    owe(l, C, 2);
    owe(l, D, 3);
    const owedC = l.cups(C);
    expect(owedC).toBe(2);

    const keep = propose(l, A, [C]);
    approve(l, B, keep.id);
    approve(l, D, keep.id);
    expect(isSpectator(l.state, C)).toBe(true);
    expect(l.cups(C)).toBe(owedC);

    const forgive = propose(l, A, [D], true, true);
    approve(l, B, forgive.id);
    expect(isSpectator(l.state, D)).toBe(true);
    expect(l.cups(D)).toBe(0);
  });

  it('spectators are not charged, cannot check in and no longer vote', () => {
    const l = group();
    const p = propose(l, A, [C]);
    approve(l, B, p.id);
    approve(l, D, p.id);

    at(l, '2026-10-26', '09:00');
    expect(l.fail(C, { type: 'CheckIn' }).code).toBe('NotPermitted');
    at(l, '2026-10-27', '00:05');
    const due = missedDays(l.state, l.now).map((d) => d.playerId);
    expect(due).toEqual(expect.arrayContaining([A, B, D]));
    expect(due).not.toContain(C);
    l.run(A, { type: 'SettleAttendance' });
    expect(l.cups(C)).toBe(0);

    // C is left out of later ballots, but can still raise one.
    const holiday = l.run(A, { type: 'ProposeMotion', motion: { kind: 'holiday', date: '2026-10-30', name: '창립기념일', off: true } })[0]!;
    expect(l.state.motions[holiday.id]?.voters).toEqual([A, B, D]);
  });

  it('brings them back by the same motion, without charging the days away', () => {
    const l = group();
    const out = propose(l, A, [C]);
    approve(l, B, out.id);
    approve(l, D, out.id);

    at(l, '2026-10-27', '09:00');
    const back = propose(l, C, [C], false);
    // A spectator asks to return; the participants decide.
    expect(l.state.motions[back.id]?.voters).toEqual([A, B, D]);
    approve(l, A, back.id);
    approve(l, B, back.id);
    approve(l, D, back.id);
    expect(isSpectator(l.state, C)).toBe(false);

    at(l, '2026-10-28', '00:05');
    l.run(A, { type: 'SettleAttendance' });
    // Tuesday 10-27 is the day they came back: nothing is owed for it or for the days before.
    expect(l.cups(C)).toBe(0);
  });

  it('refuses motions that change nothing or would leave nobody', () => {
    const l = group();
    expect(l.fail(A, { type: 'ProposeMotion', motion: { kind: 'spectate', playerIds: [C], spectator: false } }).code).toBe('NoChange');
    expect(l.fail(A, { type: 'ProposeMotion', motion: { kind: 'spectate', playerIds: [], spectator: true } }).code).toBe('InvalidInput');
    expect(l.fail(A, { type: 'ProposeMotion', motion: { kind: 'spectate', playerIds: [A, B, C, D], spectator: true } }).code).toBe(
      'NoEligibleVoters',
    );
    const p = propose(l, A, [C]);
    approve(l, B, p.id);
    approve(l, D, p.id);
    expect(l.fail(A, { type: 'ProposeMotion', motion: { kind: 'spectate', playerIds: [C], spectator: true } }).code).toBe('NoChange');
  });

  it('is an attendance-mode motion', () => {
    const l = createLedger();
    l.join(A, B);
    l.claim(B);
    expect(l.fail(A, { type: 'ProposeMotion', motion: { kind: 'spectate', playerIds: [B], spectator: true } }).code).toBe('WrongMode');
  });

  it('a lone participant decides without a vote', () => {
    const l = createLedger();
    l.join(A, B);
    l.run(A, { type: 'ChangeMode', mode: 'attendance' });
    const p = propose(l, A, [B]);
    expect(l.state.motions[p.id]?.status).toBe('approved');
    expect(isSpectator(l.state, B)).toBe(true);
  });

  it('ignores forged events: forgiving a return, or moving players the proposer was not allowed to', () => {
    const l = group();
    const out = propose(l, A, [C]);
    approve(l, B, out.id);
    approve(l, D, out.id);

    // Forgiveness only makes sense when turning into a spectator.
    const forged = l.decideOnly(A, { type: 'ProposeMotion', motion: { kind: 'spectate', playerIds: [C], spectator: false } })[0]!;
    if (forged.type !== 'MotionProposed' || forged.motion.kind !== 'spectate') throw new Error('unexpected event');
    const tampered: LedgerEvent = { ...forged, motion: { ...forged.motion, forgive: true } };
    l.apply(tampered);
    expect(l.state.motions[tampered.id]).toBeUndefined();

    // A voter list that includes the people being moved is forged.
    const real = l.decideOnly(A, { type: 'ProposeMotion', motion: { kind: 'spectate', playerIds: [D], spectator: true } })[0]!;
    if (real.type !== 'MotionProposed') throw new Error('unexpected event');
    const padded: LedgerEvent = { ...real, id: 'forged-voters' as typeof real.id, voters: [...real.voters, D] };
    l.apply(padded);
    expect(l.state.motions[padded.id]).toBeUndefined();
  });
});

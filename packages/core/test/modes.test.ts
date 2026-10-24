import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, missedDays, missedEventId, type LedgerEvent } from '../src';
import { A, B, C, D, GROUP, createLedger, type Ledger } from './harness';

const DAY = 24 * 60;

/** Moves the clock and `today` together; the harness clock starts Fri 2026-10-23 09:00 KST. */
function at(l: Ledger, date: string, hhmm: string) {
  const target = Date.parse(`${date}T${hhmm}:00+09:00`);
  l.advanceMinutes((target - Date.parse(l.now)) / 60_000);
  l.setToday(date);
}

/** A, B, C in attendance mode with rules adopted on Fri 10-23 (judged from Sat 10-24). */
function attendance() {
  const l = createLedger();
  l.join(A, B, C);
  l.claim(B, C);
  l.run(A, { type: 'ChangeMode', mode: 'attendance' });
  l.run(A, { type: 'AdoptRules', ruleset: DEFAULT_RULESET });
  return l;
}

const settle = (l: Ledger, by = A): LedgerEvent[] => l.run(by, { type: 'SettleAttendance' });

describe('modes', () => {
  it('only the owner changes the mode; the shared ledger is the default for existing groups', () => {
    const l = createLedger();
    l.join(A, B);
    expect(l.state.mode).toBe('shared');
    expect(l.fail(B, { type: 'ChangeMode', mode: 'attendance' }).code).toBe('NotPermitted');
    l.run(A, { type: 'ChangeMode', mode: 'attendance' });
    expect(l.state.mode).toBe('attendance');
    expect(l.fail(A, { type: 'RecordArrival', playerId: B, arrivedAt: '09:30' }).code).toBe('WrongMode');
    expect(l.fail(A, { type: 'Redeem', debtorId: B, count: 1, recipients: [A], stampQuality: 'clean' }).code).toBe(
      'WrongMode',
    );
  });

  it('switching modes asks for the rules to be confirmed again', () => {
    const l = attendance();
    expect(l.state.attendance.startsOn).toBe('2026-10-24');
    l.run(A, { type: 'ChangeMode', mode: 'shared' });
    l.run(A, { type: 'ChangeMode', mode: 'attendance' });
    expect(l.state.attendance.startsOn).toBeUndefined();
    expect(l.fail(B, { type: 'CheckIn' }).code).toBe('RulesNotAdopted');
  });

  it('hands the owner role over', () => {
    const l = createLedger();
    l.join(A, B);
    expect(l.fail(B, { type: 'TransferOwner', to: B }).code).toBe('NotPermitted');
    l.run(A, { type: 'TransferOwner', to: B });
    expect(l.state.players[A]?.role).toBe('member');
    expect(l.state.players[B]?.role).toBe('owner');
    expect(l.fail(A, { type: 'ChangeMode', mode: 'attendance' }).code).toBe('NotPermitted');
  });
});

describe('attendance mode', () => {
  it('rules are adopted once, explicitly, and judged from the next day', () => {
    const l = attendance();
    expect(l.fail(A, { type: 'AdoptRules', ruleset: DEFAULT_RULESET }).code).toBe('AlreadyAdopted');
    expect(l.fail(B, { type: 'CheckIn' }).code).toBe('RulesNotAdopted');
    expect(l.fail(A, { type: 'ChangeRuleset', ruleset: DEFAULT_RULESET }).code).toBe('WrongMode');
  });

  it('check-ins are judged by their own time; late ones cost cups by the rules', () => {
    const l = attendance();
    at(l, '2026-10-26', '08:59'); // Monday
    l.run(A, { type: 'CheckIn' });
    at(l, '2026-10-26', '09:10');
    const [late] = l.run(B, { type: 'CheckIn' });
    expect(l.fail(B, { type: 'CheckIn' }).code).toBe('AlreadyCheckedIn');
    expect(l.cups(A)).toBe(0);
    expect(l.cups(B)).toBe(1);
    expect(l.state.lates[late!.id]).toMatchObject({ origin: 'checkIn', arrivedAt: '09:10', minutesLate: 10 });
    expect(l.state.onTimes.map((o) => o.playerId)).toEqual([A]);
  });

  it('server time decides the day: a check-in that lands on another date is ignored', () => {
    const l = attendance();
    at(l, '2026-10-26', '09:00');
    const [e] = l.decideOnly(B, { type: 'CheckIn' });
    l.apply({ ...e!, serverAt: '2026-10-27T00:00:00.000Z' } as LedgerEvent);
    expect(l.state.attendance.days[`${B}|2026-10-26`]).toBeUndefined();
  });

  it('weekends and holidays need no check-in', () => {
    const l = attendance();
    at(l, '2026-10-24', '10:00'); // Saturday
    expect(l.fail(B, { type: 'CheckIn' }).code).toBe('NotAWorkday');
  });

  it('missed work days are settled once the day is over, idempotently and with the most cups', () => {
    const l = attendance();
    at(l, '2026-10-26', '09:00');
    l.run(A, { type: 'CheckIn' });
    l.run(B, { type: 'CheckIn' });
    // Nothing is due while Monday is still going.
    expect(missedDays(l.state, l.now)).toEqual([]);

    at(l, '2026-10-27', '00:05');
    const events = settle(l, B);
    expect(events.map((e) => [e.type, e.id])).toEqual([['AttendanceMissed', missedEventId(GROUP, C, '2026-10-26')]]);
    expect(l.cups(C)).toBe(1);
    expect(settle(l)).toEqual([]);
    // A second device that settled the same day produces the same id; replaying it changes nothing.
    l.apply({ ...events[0]!, actorId: A });
    expect(l.cups(C)).toBe(1);
  });

  it('a missed-day event from before the day ended is ignored', () => {
    const l = attendance();
    at(l, '2026-10-26', '18:00');
    l.apply({
      id: missedEventId(GROUP, C, '2026-10-26'),
      groupId: GROUP,
      actorId: A,
      at: l.now,
      schemaVersion: 1,
      type: 'AttendanceMissed',
      playerId: C,
      workDate: '2026-10-26',
    } as LedgerEvent);
    expect(l.cups(C)).toBe(0);
  });

  it('players who joined that day or later are not charged for it', () => {
    const l = attendance();
    at(l, '2026-10-26', '11:00');
    const [joined] = l.run(B, { type: 'AddPlayer', name: 'late joiner', appearance: { color: '#000' } });
    l.claim((joined as { player: { id: typeof A } }).player.id);
    at(l, '2026-10-27', '00:05');
    expect(missedDays(l.state, l.now).map((d) => d.playerId)).toEqual([A, B, C]);
  });

  it('a vacation registered afterwards excuses the missed day', () => {
    const l = attendance();
    at(l, '2026-10-27', '00:05');
    settle(l);
    expect(l.cups(C)).toBe(1);
    l.run(C, { type: 'SetVacation', date: '2026-10-26', on: true });
    expect(l.cups(C)).toBe(0);
    expect(Object.values(l.state.lates).find((r) => r?.playerId === C)?.status).toBe('excused');
  });

  it('holidays are common rules: proposed, voted unanimously, and excuse everyone', () => {
    const l = attendance();
    at(l, '2026-10-27', '00:05');
    settle(l);
    expect(l.fail(A, { type: 'SetHoliday', date: '2026-10-26', name: '창립기념일', off: true }).code).toBe('WrongMode');
    const [proposed] = l.run(A, {
      type: 'ProposeMotion',
      motion: { kind: 'holiday', date: '2026-10-26', name: '창립기념일', off: true },
    });
    l.run(B, { type: 'VoteMotion', motionId: proposed!.id, vote: 'approve' });
    expect(l.cups(A)).toBe(1);
    l.run(C, { type: 'VoteMotion', motionId: proposed!.id, vote: 'approve' });
    expect([A, B, C].map((p) => l.cups(p))).toEqual([0, 0, 0]);
    expect(l.state.motions[proposed!.id]?.status).toBe('approved');
  });

  it('built-in public holidays need no check-in and can be switched off', () => {
    const l = attendance();
    at(l, '2026-12-26', '00:05'); // after 성탄절 (Fri 12-25)
    expect(missedDays(l.state, l.now).some((d) => d.workDate === '2026-12-25')).toBe(false);
  });

  it('rule changes pass only when everyone approves', () => {
    const l = attendance();
    const ruleset = { ...DEFAULT_RULESET, defaultStartTime: '10:00' };
    const [p] = l.run(B, { type: 'ProposeMotion', motion: { kind: 'ruleset', ruleset } });
    l.run(A, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' });
    l.run(C, { type: 'VoteMotion', motionId: p!.id, vote: 'reject' });
    expect(l.state.motions[p!.id]?.status).toBe('rejected');
    expect(l.state.rulesets.at(-1)?.ruleset.defaultStartTime).toBe('09:00');
  });

  it("someone else's cup needs n−2 approvals; one's own needs n−1", () => {
    const l = attendance();
    at(l, '2026-10-27', '00:05');
    settle(l);
    // A proposes C's cup: only B votes.
    const [other] = l.run(A, {
      type: 'ProposeMotion',
      motion: { kind: 'redeem', debtorId: C, recipients: [A], stampQuality: 'clean' },
    });
    expect(l.state.motions[other!.id]?.voters).toEqual([B]);
    l.run(B, { type: 'VoteMotion', motionId: other!.id, vote: 'approve' });
    expect(l.cups(C)).toBe(0);
    expect(l.state.towers[A]?.received).toHaveLength(1);

    // B pays their own: A and C vote.
    const [own] = l.run(B, {
      type: 'ProposeMotion',
      motion: { kind: 'redeem', debtorId: B, recipients: [A, C], stampQuality: 'faint' },
    });
    expect(l.state.motions[own!.id]?.voters).toEqual([A, C]);
    l.run(A, { type: 'VoteMotion', motionId: own!.id, vote: 'approve' });
    expect(l.cups(B)).toBe(1);
    l.run(C, { type: 'VoteMotion', motionId: own!.id, vote: 'approve' });
    expect(l.cups(B)).toBe(0);
  });

  it("in a group of two, the other person's cup is paid back at once", () => {
    const l = createLedger();
    l.join(A, B);
    l.claim(B);
    l.run(A, { type: 'ChangeMode', mode: 'attendance' });
    l.run(A, { type: 'AdoptRules', ruleset: DEFAULT_RULESET });
    at(l, '2026-10-27', '00:05');
    settle(l);
    expect(l.cups(B)).toBe(1);
    l.run(A, { type: 'ProposeMotion', motion: { kind: 'redeem', debtorId: B, recipients: [A], stampQuality: 'clean' } });
    expect(l.cups(B)).toBe(0);
  });

  it('cups already offered in an open redeem motion cannot be offered again', () => {
    const l = attendance();
    at(l, '2026-10-27', '00:05');
    settle(l);
    l.run(A, { type: 'ProposeMotion', motion: { kind: 'redeem', debtorId: C, recipients: [A], stampQuality: 'clean' } });
    expect(
      l.fail(B, { type: 'ProposeMotion', motion: { kind: 'redeem', debtorId: C, recipients: [B], stampQuality: 'clean' } })
        .code,
    ).toBe('NothingToRedeem');
  });
});

describe('adjust motions (any mode)', () => {
  it('adds cups regardless of dates once everyone but the player approves', () => {
    const l = createLedger();
    l.join(A, B, C);
    l.claim(B, C);
    const [p] = l.run(A, { type: 'ProposeMotion', motion: { kind: 'adjust', playerId: B, delta: 2, reason: ' 회식 지각 ' } });
    expect(l.state.motions[p!.id]?.voters).toEqual([A, C]);
    expect(l.cups(B)).toBe(0);
    l.run(C, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' });
    expect(l.cups(B)).toBe(2);
    expect(l.state.lates[p!.id]).toMatchObject({ origin: 'adjustment', cups: 2, note: '회식 지각' });
  });

  it('removes cups from the top and lowers the claims behind them', () => {
    const l = createLedger();
    l.join(A, B, C);
    l.claim(B, C);
    const first = l.late(B, '09:10');
    const second = l.late(B, '09:10', { cups: 2 });
    const [p] = l.run(A, { type: 'ProposeMotion', motion: { kind: 'adjust', playerId: B, delta: -2, reason: '착오' } });
    l.run(C, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' });
    expect(l.cups(B)).toBe(1);
    expect(l.state.lates[second]?.status).toBe('waived');
    expect(l.state.lates[first]?.status).toBe('active');
  });

  it('needs a reason and cannot take away more than is owed', () => {
    const l = createLedger();
    l.join(A, B);
    expect(l.fail(A, { type: 'ProposeMotion', motion: { kind: 'adjust', playerId: B, delta: 1, reason: ' ' } }).code).toBe(
      'ReasonRequired',
    );
    expect(l.fail(A, { type: 'ProposeMotion', motion: { kind: 'adjust', playerId: B, delta: -1, reason: 'x' } }).code).toBe(
      'RedeemExceedsDebt',
    );
  });

  it('the proposer can withdraw; others cannot', () => {
    const l = createLedger();
    l.join(A, B, C);
    l.claim(B, C);
    const [p] = l.run(A, { type: 'ProposeMotion', motion: { kind: 'adjust', playerId: B, delta: 1, reason: 'x' } });
    expect(l.fail(C, { type: 'WithdrawMotion', motionId: p!.id }).code).toBe('NotPermitted');
    l.run(A, { type: 'WithdrawMotion', motionId: p!.id });
    expect(l.fail(C, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' }).code).toBe('ProposalClosed');
  });

  it('expires after the waive TTL', () => {
    const l = createLedger();
    l.join(A, B, C);
    l.claim(B, C);
    const [p] = l.run(A, { type: 'ProposeMotion', motion: { kind: 'adjust', playerId: B, delta: 1, reason: 'x' } });
    l.advanceMinutes(3 * DAY + 1);
    expect(l.fail(C, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' }).code).toBe('ProposalClosed');
  });
});

/** Events forged by a member's own client: the server checks only actor and ballots, so evolve must refuse them. */
describe('forged and invalid events (review)', () => {
  const forge = (l: Ledger, actor: typeof A, payload: Record<string, unknown>, id = `f${Math.random()}`): LedgerEvent =>
    ({ id, groupId: GROUP, actorId: actor, at: l.now, schemaVersion: 1, ...payload }) as unknown as LedgerEvent;
  const expires = (l: Ledger) => new Date(Date.parse(l.now) + 72 * 3_600_000).toISOString();

  function withMissedCup() {
    const l = attendance();
    at(l, '2026-10-27', '00:05');
    settle(l);
    return l;
  }

  it('a motion with a forged (empty or partial) voter list is ignored', () => {
    const l = withMissedCup();
    const motion = { kind: 'adjust', playerId: C, delta: -1, reason: 'x' };
    l.apply(forge(l, C, { type: 'MotionProposed', motion: { ...motion, playerId: A, delta: 1 }, voters: [], expiresAt: expires(l) }));
    l.apply(forge(l, B, { type: 'MotionProposed', motion, voters: [B], expiresAt: expires(l) }));
    expect(l.cups(C)).toBe(1);
    expect(l.cups(A)).toBe(1);
    expect(l.state.motionOrder).toEqual([]);
  });

  it('unbounded or malformed payloads are ignored instead of throwing', () => {
    const l = withMissedCup();
    const voters = [B, C];
    l.apply(forge(l, A, { type: 'MotionProposed', motion: { kind: 'adjust', playerId: B, delta: 2 ** 32, reason: 'x' }, voters: [A, C], expiresAt: expires(l) }));
    l.apply(forge(l, A, { type: 'MotionProposed', motion: { kind: 'ruleset', ruleset: { ...DEFAULT_RULESET, timezone: 'Not/AZone' } }, voters, expiresAt: expires(l) }));
    l.apply(forge(l, A, { type: 'MotionProposed', motion: { kind: 'nonsense' }, voters, expiresAt: expires(l) }));
    l.apply(forge(l, A, { type: 'RulesetChanged', ruleset: { ...DEFAULT_RULESET, timezone: 'Not/AZone' }, effectiveFrom: '2026-10-27' }));
    expect(l.state.motionOrder).toEqual([]);
    expect(() => l.apply(forge(l, A, { type: 'PlayerJoined', player: { id: 'Z', name: 'z', role: 'member', appearance: { color: '#000' }, archived: false } }))).not.toThrow();
  });

  it('a deadline far beyond the TTL is forged', () => {
    const l = withMissedCup();
    const motion = { kind: 'adjust', playerId: C, delta: 1, reason: 'x' };
    l.apply(forge(l, A, { type: 'MotionProposed', motion, voters: [A, B], expiresAt: '2099-01-01T00:00:00.000Z' }));
    expect(l.state.motionOrder).toEqual([]);
  });

  it('attendance records and adjustments cannot be retracted; agreed redemptions cannot be reverted', () => {
    const l = attendance();
    at(l, '2026-10-26', '10:30');
    const [late] = l.run(B, { type: 'CheckIn' });
    l.advanceMinutes(2);
    expect(l.fail(B, { type: 'RetractLate', targetId: late!.id }).code).toBe('NotPermitted');
    l.apply(forge(l, B, { type: 'LateRetracted', targetId: late!.id }));
    expect(l.cups(B)).toBe(1);

    const [adj] = l.run(A, { type: 'ProposeMotion', motion: { kind: 'adjust', playerId: C, delta: 2, reason: 'x' } });
    l.run(B, { type: 'VoteMotion', motionId: adj!.id, vote: 'approve' });
    l.apply(forge(l, A, { type: 'LateRetracted', targetId: adj!.id }));
    expect(l.cups(C)).toBe(2);

    const [paid] = l.run(A, { type: 'ProposeMotion', motion: { kind: 'redeem', debtorId: C, recipients: [A], stampQuality: 'clean' } });
    l.run(B, { type: 'VoteMotion', motionId: paid!.id, vote: 'approve' });
    expect(l.cups(C)).toBe(1);
    expect(l.fail(A, { type: 'RevertRedemption', redemptionId: paid!.id }).code).toBe('NotPermitted');
    l.apply(forge(l, A, { type: 'RedemptionReverted', redemptionId: paid!.id }));
    expect(l.cups(C)).toBe(1);
  });

  it('members cannot strip the owner role or archive others through PlayerUpdated', () => {
    const l = attendance();
    l.apply(forge(l, B, { type: 'PlayerUpdated', playerId: A, patch: { role: 'member' } }));
    l.apply(forge(l, B, { type: 'PlayerUpdated', playerId: C, patch: { archived: true } }));
    l.apply(forge(l, B, { type: 'PlayerUpdated', playerId: B, patch: { role: 'owner', name: 'B2' } }));
    expect(l.state.players[A]?.role).toBe('owner');
    expect(l.state.players[C]?.archived).toBe(false);
    expect(l.state.players[B]).toMatchObject({ role: 'member', name: 'B2' });
  });

  it('days spent archived are not charged after coming back', () => {
    const l = attendance();
    at(l, '2026-10-26', '08:00');
    l.run(A, { type: 'UpdatePlayer', playerId: C, patch: { archived: true } });
    at(l, '2026-11-09', '08:00');
    l.run(A, { type: 'UpdatePlayer', playerId: C, patch: { archived: false } });
    at(l, '2026-11-10', '00:05');
    expect(missedDays(l.state, l.now).filter((d) => d.playerId === C)).toEqual([]);
  });

  it('players someone else added and nobody uses are not charged and do not vote', () => {
    const l = createLedger();
    l.join(A, B, C);
    l.claim(B); // C is never used
    l.run(A, { type: 'ChangeMode', mode: 'attendance' });
    l.run(A, { type: 'AdoptRules', ruleset: DEFAULT_RULESET });
    at(l, '2026-10-27', '00:05');
    expect(missedDays(l.state, l.now).map((d) => d.playerId)).toEqual([A, B]);
    const [p] = l.run(A, { type: 'ProposeMotion', motion: { kind: 'holiday', date: '2026-11-02', name: 'x', off: true } });
    expect(l.state.motions[p!.id]?.voters).toEqual([A, B]);
  });

  it('switching modes voids motions that only made sense in the old mode', () => {
    const l = attendance();
    const [p] = l.run(A, { type: 'ProposeMotion', motion: { kind: 'holiday', date: '2026-11-02', name: 'x', off: true } });
    l.run(A, { type: 'ChangeMode', mode: 'shared' });
    expect(l.state.motions[p!.id]?.status).toBe('void');
  });

  it('adopting rules drops rulesets planted for later dates', () => {
    const l = createLedger();
    l.join(A, B);
    l.run(A, { type: 'ChangeMode', mode: 'attendance' });
    l.apply(forge(l, A, { type: 'RulesetChanged', ruleset: { ...DEFAULT_RULESET, graceMinutes: 30 }, effectiveFrom: '2026-12-01' }));
    l.run(A, { type: 'AdoptRules', ruleset: DEFAULT_RULESET });
    expect(l.state.rulesets.map((r) => r.effectiveFrom)).toEqual(['2026-10-23']);
  });

  it('settles yesterday only a few minutes after midnight', () => {
    const l = attendance();
    at(l, '2026-10-27', '00:01');
    expect(missedDays(l.state, l.now)).toEqual([]);
    at(l, '2026-10-27', '00:05');
    expect(missedDays(l.state, l.now).length).toBeGreaterThan(0);
  });
});

describe('acted players (re-review)', () => {
  it("a player's first own event does not charge the days before it", () => {
    const l = createLedger();
    l.join(A, B, D);
    l.claim(B);
    l.run(A, { type: 'ChangeMode', mode: 'attendance' });
    l.run(A, { type: 'AdoptRules', ruleset: DEFAULT_RULESET });
    at(l, '2026-11-09', '10:00');
    l.claim(D);
    at(l, '2026-11-10', '00:05');
    expect(missedDays(l.state, l.now).filter((d) => d.playerId === D).map((d) => d.workDate)).toEqual([]);
    at(l, '2026-11-11', '00:05');
    expect(missedDays(l.state, l.now).filter((d) => d.playerId === D).map((d) => d.workDate)).toEqual(['2026-11-10']);
  });

  it('a voter list that lags behind someone who just joined still counts; a list missing an older member does not', () => {
    const l = attendance();
    // The proposer's device builds the list before D's claim reaches the server.
    l.join(D);
    const [proposed, vote] = l.decideOnly(A, { type: 'ProposeMotion', motion: { kind: 'holiday', date: '2026-11-02', name: 'x', off: true } });
    l.advanceMinutes(1);
    l.claim(D);
    l.apply({ ...proposed!, serverAt: l.now } as LedgerEvent, { ...vote!, serverAt: l.now } as LedgerEvent);
    expect(l.state.motions[proposed!.id]?.voters).toEqual([A, B, C]);

    const forged = { ...proposed!, id: 'forged', voters: [A, B], serverAt: l.now } as LedgerEvent;
    l.apply(forged);
    expect(l.state.motions[forged.id]).toBeUndefined();
  });
});

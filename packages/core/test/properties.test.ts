import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { project, type Command, type EventId, type LedgerEvent, type LedgerState, type PlayerId } from '../src';
import { A, B, C, D, createLedger } from './harness';

const PLAYERS = [A, B, C, D];

/** Structural invariants that must hold after any sequence of events, in any order. */
function checkInvariants(s: LedgerState) {
  const seen = new Set<string>();
  for (const id of s.playerOrder) {
    for (const cup of s.towers[id]?.cups ?? []) {
      expect(seen.has(cup.id), `duplicate cup ${cup.id}`).toBe(false);
      seen.add(cup.id);
      const rec = s.lates[cup.sourceId];
      expect(rec?.status, `cup ${cup.id} of inactive record`).toBe('active');
      expect(rec?.playerId).toBe(id);
    }
  }

  const openPerTarget = new Map<EventId, number>();
  for (const pid of s.proposalOrder) {
    const p = s.proposals[pid]!;
    if (p.status === 'open') openPerTarget.set(p.targetId, (openPerTarget.get(p.targetId) ?? 0) + 1);
    if (p.status === 'approved') {
      expect(p.voters.every((v) => p.votes[v] === 'approve'), `approved without unanimity ${pid}`).toBe(true);
      expect(s.lates[p.targetId]?.status).not.toBe('active');
    }
    if (p.status === 'rejected') expect(Object.values(p.votes)).toContain('reject');
    for (const voter of Object.keys(p.votes)) expect(p.voters).toContain(voter);
  }
  for (const n of openPerTarget.values()) expect(n).toBe(1);

  for (const id of s.lateOrder) {
    const r = s.lates[id]!;
    const alive = (s.towers[r.playerId]?.cups ?? []).filter((c) => c.sourceId === id).length;
    expect(alive, `alive cups of ${id}`).toBe(r.status === 'active' ? Math.max(0, r.cups - r.redeemed) : 0);
    expect(r.cups).toBeGreaterThanOrEqual(1);
    if (r.openProposalId) {
      const p = s.proposals[r.openProposalId];
      expect(p?.status).toBe('open');
      expect(p?.targetId).toBe(id);
    }
  }
}

// An op is a recipe with numeric picks; picks index into whatever exists at execution time.
const pick = fc.nat({ max: 1000 });
const op = fc.oneof(
  { weight: 5, arbitrary: fc.record({ k: fc.constant('late' as const), actor: pick, player: pick, minute: fc.integer({ min: 0, max: 120 }), cups: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('correct' as const), actor: pick, rec: pick, cups: fc.integer({ min: 0, max: 4 }), minute: fc.option(fc.integer({ min: 0, max: 120 }), { nil: undefined }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('retract' as const), actor: pick, rec: pick }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('propose' as const), actor: pick, rec: pick }) },
  { weight: 5, arbitrary: fc.record({ k: fc.constant('vote' as const), actor: pick, prop: pick, approve: fc.integer({ min: 0, max: 9 }).map((n) => n < 8) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('withdraw' as const), actor: pick, prop: pick }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant('redeem' as const), actor: pick, player: pick, count: pick, oldest: fc.boolean(), to: fc.subarray([0, 1, 2, 3], { minLength: 1 }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('time' as const), minutes: fc.integer({ min: 1, max: 60 * 30 }) }) },
);type Op = typeof op extends fc.Arbitrary<infer T> ? T : never;

const at = <T>(xs: readonly T[], i: number): T | undefined => (xs.length ? xs[i % xs.length] : undefined);
const hhmm = (minuteAfterNine: number) => {
  const t = 9 * 60 + minuteAfterNine;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

function toCommand(s: LedgerState, o: Op): { actor: PlayerId; cmd: Command } | undefined {
  if (o.k === 'time') return undefined;
  const actor = at(PLAYERS, o.actor)!;
  switch (o.k) {
    case 'late':
      return {
        actor,
        cmd: {
          type: 'RecordArrival',
          playerId: at(PLAYERS, o.player)!,
          arrivedAt: hhmm(o.minute),
          allowDuplicate: true,
          ...(o.cups !== undefined && { cupsOverride: o.cups }),
        },
      };
    case 'correct': {
      const targetId = at(s.lateOrder, o.rec);
      if (!targetId) return undefined;
      const changes = o.minute !== undefined ? { arrivedAt: hhmm(o.minute) } : { cups: o.cups };
      return { actor, cmd: { type: 'CorrectLate', targetId, changes } };
    }
    case 'retract': {
      const targetId = at(s.lateOrder, o.rec);
      return targetId && { actor, cmd: { type: 'RetractLate', targetId } };
    }
    case 'propose': {
      const targetId = at(s.lateOrder, o.rec);
      return targetId && { actor, cmd: { type: 'ProposeWaive', targetId, reason: 'r' } };
    }
    case 'vote': {
      // Mostly target open proposals with a voter who still has a ballot, so approvals actually happen.
      const open = s.proposalOrder.filter((id) => s.proposals[id]?.status === 'open');
      const proposalId = at(open, o.prop) ?? at(s.proposalOrder, o.prop);
      if (!proposalId) return undefined;
      const p = s.proposals[proposalId]!;
      const voter = at(p.voters.filter((v) => p.votes[v] === undefined), o.actor) ?? actor;
      return { actor: voter, cmd: { type: 'VoteWaive', proposalId, vote: o.approve ? 'approve' : 'reject' } };
    }
    case 'withdraw': {
      const proposalId = at(s.proposalOrder, o.prop);
      return proposalId && { actor, cmd: { type: 'WithdrawWaive', proposalId } };
    }
    case 'redeem': {
      const debtors = PLAYERS.filter((p) => (s.towers[p]?.cups.length ?? 0) > 0);
      const debtorId = at(debtors, o.player);
      if (!debtorId) return undefined;
      return {
        actor,
        cmd: {
          type: 'Redeem',
          debtorId,
          count: 1 + (o.count % s.towers[debtorId]!.cups.length),
          recipients: o.to.map((i) => PLAYERS[i]!),
          order: o.oldest ? 'oldest' : 'newest',
          stampQuality: 'clean',
        },
      };
    }
  }
}

/** Runs ops through decide/evolve, skipping commands the domain rejects. */
function simulate(ops: Op[]) {
  const l = createLedger();
  l.join(...PLAYERS);
  for (const o of ops) {
    if (o.k === 'time') {
      l.advanceMinutes(o.minutes);
      continue;
    }
    const c = toCommand(l.state, o);
    if (!c) continue;
    try {
      l.run(c.actor, c.cmd);
    } catch {
      // rejected by decide — fine, that's the point of the domain checks
    }
  }
  return l;
}

const RUNS = { numRuns: 300 };
const OPS = fc.array(op, { minLength: 5, maxLength: 80, size: 'medium' });

describe('properties', () => {
  it('invariants hold for any accepted command sequence', () => {
    fc.assert(
      fc.property(OPS, (ops) => {
        checkInvariants(simulate(ops).state);
      }),
      RUNS,
    );
  });

  it('replaying the event log rebuilds exactly the same state', () => {
    fc.assert(
      fc.property(OPS, (ops) => {
        const l = simulate(ops);
        expect(project(l.events)).toEqual(l.state);
      }),
      RUNS,
    );
  });

  it('invariants survive arbitrary delivery order (sync races)', () => {
    fc.assert(
      fc.property(
        OPS.chain((ops) => {
          const events = simulate(ops).events;
          const players = events.filter((e) => e.type === 'PlayerJoined');
          const rest = events.filter((e) => e.type !== 'PlayerJoined');
          return fc.shuffledSubarray(rest, { minLength: rest.length }).map((shuffled): LedgerEvent[] => [
            ...players,
            ...shuffled,
          ]);
        }),
        (events) => {
          checkInvariants(project(events));
        },
      ),
      RUNS,
    );
  });
});

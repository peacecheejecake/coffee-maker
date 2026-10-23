import { asGroupId, type GroupId, type LedgerEvent, type PlayerId } from '@coffee/core';
import type { PushResult, RemoteStatus, RemoteSync } from '../src';

interface Member {
  playerId: PlayerId | null;
  role: 'owner' | 'member';
}

/** In-memory stand-in for the Supabase schema: same rules as append_events, server clock, live subscribers. */
export class FakeServer {
  seq = 0;
  events: LedgerEvent[] = [];
  groups = new Map<string, { invite: string; members: Map<string, Member> }>();
  subs = new Set<{ groupId: string; cb: (e: LedgerEvent[]) => void }>();
  constructor(public now: () => Date) {}

  remoteFor(userId: string, net: { online: boolean } = { online: true }): RemoteSync {
    // The returned object literal has its own methods; keep a handle on the server for them.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const server = this;
    const guard = async () => {
      if (!net.online) throw new Error('network down');
    };
    return {
      ensureSession: guard,
      async createGroup({ groupId, playerId }) {
        await guard();
        const invite = `INV${server.groups.size + 1}`;
        server.groups.set(groupId, { invite, members: new Map([[userId, { playerId, role: 'owner' }]]) });
        return { inviteCode: invite };
      },
      async joinGroup(code) {
        await guard();
        const entry = [...server.groups.entries()].find(([, g]) => g.invite === code.toUpperCase());
        if (!entry) throw new Error('invalid_invite');
        const [id, g] = entry;
        if (!g.members.has(userId)) g.members.set(userId, { playerId: null, role: 'member' });
        return { groupId: asGroupId(id), playerId: g.members.get(userId)!.playerId };
      },
      async claimPlayer(groupId, playerId) {
        await guard();
        const g = server.groups.get(groupId)!;
        for (const [u, m] of g.members) if (u !== userId && m.playerId === playerId) throw new Error('player_taken');
        g.members.get(userId)!.playerId = playerId;
      },
      async claimedPlayers(groupId) {
        await guard();
        return [...server.groups.get(groupId)!.members.values()].flatMap((m) => (m.playerId ? [m.playerId] : []));
      },
      async inviteCode(groupId) {
        return server.groups.get(groupId)?.invite ?? null;
      },
      async push(events) {
        await guard();
        return events.map((e) => server.append(userId, e));
      },
      async pull(groupId: GroupId, after: number) {
        await guard();
        return server.events.filter((e) => e.groupId === groupId && e.seq! > after);
      },
      savePushSubscription: async () => {},
      deletePushSubscription: async () => {},
      saveNativePushToken: async () => {},
      deleteNativePushToken: async () => {},
      account: async () => ({ anonymous: true }),
      linkAccount: async () => {},
      subscribe(groupId, cb, onStatus: (s: RemoteStatus) => void) {
        const sub = { groupId, cb: (e: LedgerEvent[]) => net.online && cb(e) };
        server.subs.add(sub);
        queueMicrotask(() => onStatus('subscribed'));
        return () => server.subs.delete(sub);
      },
    };
  }

  private append(userId: string, e: LedgerEvent): PushResult {
    const existing = this.events.find((x) => x.id === e.id);
    if (existing) return { id: e.id, seq: existing.seq!, serverAt: existing.serverAt! };
    const member = this.groups.get(e.groupId)?.members.get(userId);
    const reject = (error: string): PushResult => ({ id: e.id, error });
    if (!member || member.playerId !== e.actorId) return reject('not_actor');
    const now = this.now();
    if (e.type === 'RulesetChanged' && member.role !== 'owner') return reject('owner_only');
    if (e.type === 'WaiveVoted') {
      const p = this.events.find((x) => x.id === e.proposalId);
      if (!p || p.type !== 'WaiveProposed') return reject('no_proposal');
      if (!p.voters.includes(e.actorId)) return reject('not_a_voter');
      if (now.getTime() > Date.parse(p.expiresAt)) return reject('proposal_expired');
      if (this.events.some((x) => x.type === 'WaiveVoted' && x.proposalId === e.proposalId && x.actorId === e.actorId)) {
        return reject('already_voted');
      }
    }
    const stored = { ...e, seq: ++this.seq, serverAt: now.toISOString() };
    this.events.push(stored);
    for (const s of this.subs) if (s.groupId === e.groupId) queueMicrotask(() => s.cb([stored]));
    return { id: e.id, seq: stored.seq, serverAt: stored.serverAt };
  }
}

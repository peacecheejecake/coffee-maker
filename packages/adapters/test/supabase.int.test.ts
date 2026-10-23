/**
 * Integration tests against a running local Supabase (`pnpm supabase start`). They exercise the real
 * migration: RPC validation, RLS, Realtime. Skipped when SUPABASE_URL / SUPABASE_ANON_KEY are not set.
 */
import { asGroupId, asPlayerId, type LedgerEvent } from '@coffee/core';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createSupabaseAssets, createSupabaseRemote } from '../src';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const remote = () =>
  createSupabaseRemote(URL!, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Node < 22 has no global WebSocket.
    realtime: { transport: WebSocket as never },
  });

let n = 0;
const uid = () => `t${Date.now().toString(36)}${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function ev(groupId: string, actorId: string, payload: Record<string, unknown>, at = new Date()): LedgerEvent {
  return { id: uid(), groupId, actorId, at: at.toISOString(), schemaVersion: 1, ...payload } as unknown as LedgerEvent;
}

const joined = (groupId: string, id: string, role = 'member') =>
  ev(groupId, id, { type: 'PlayerJoined', player: { id, name: id, role, appearance: { color: '#000' }, archived: false } });

/** Owner A with a registered group, and member B who joined and claimed a player. */
async function setup() {
  const a = remote();
  const b = remote();
  await a.ensureSession();
  await b.ensureSession();
  const groupId = asGroupId(uid());
  const pa = asPlayerId(uid());
  const pb = asPlayerId(uid());
  const { inviteCode } = await a.createGroup({ groupId, playerId: pa, name: 'test' });
  await a.push([joined(groupId, pa, 'owner')]);
  const join = await b.joinGroup(inviteCode);
  expect(join).toEqual({ groupId, playerId: null });
  await b.claimPlayer(groupId, pb);
  await b.push([joined(groupId, pb)]);
  return { a, b, groupId, pa, pb, inviteCode };
}

describe.skipIf(!URL || !ANON)('supabase schema', () => {
  it('membership: invite join is idempotent, players cannot be claimed twice, bad codes fail', async () => {
    const { a, b, groupId, pa, pb, inviteCode } = await setup();
    expect(await b.joinGroup(inviteCode.toLowerCase())).toEqual({ groupId, playerId: pb });
    await expect(b.claimPlayer(groupId, pa)).rejects.toThrow(/player_taken/);
    await expect(b.joinGroup('NOPE0000')).rejects.toThrow(/invalid_invite/);
    expect((await a.claimedPlayers(groupId)).sort()).toEqual([pa, pb].sort());
    expect(await b.inviteCode(groupId)).toBe(inviteCode);
  });

  it('append_events: seq + server time, idempotent, owner-only rules, no impersonation', async () => {
    const { a, b, groupId, pa, pb } = await setup();
    const rules = ev(groupId, pa, { type: 'RulesetChanged', ruleset: {}, effectiveFrom: '2026-10-23' });
    const [ok] = await a.push([rules]);
    expect(ok).toMatchObject({ id: rules.id, seq: expect.any(Number), serverAt: expect.any(String) });
    expect(await a.push([rules])).toEqual([ok]); // idempotent

    const [byMember] = await b.push([ev(groupId, pb, { type: 'RulesetChanged', ruleset: {}, effectiveFrom: '2026-10-23' })]);
    expect(byMember?.error).toMatch(/owner_only/);
    const [spoof] = await b.push([ev(groupId, pa, { type: 'LateRecorded', playerId: pb })]);
    expect(spoof?.error).toMatch(/not_actor/);

    const pulled = await b.pull(groupId, 0);
    expect(pulled.map((e) => e.type)).toEqual(['PlayerJoined', 'PlayerJoined', 'RulesetChanged']);
    expect(pulled.every((e) => e.seq && e.serverAt)).toBe(true);
    expect(await b.pull(groupId, pulled[1]!.seq!)).toHaveLength(1);
  });

  it('votes: voters only, once, before the deadline (server clock)', async () => {
    const { a, b, groupId, pa, pb } = await setup();
    const late = ev(groupId, pa, { type: 'LateRecorded', playerId: pb });
    const live = ev(groupId, pa, {
      type: 'WaiveProposed',
      targetId: late.id,
      voters: [pa],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const expired = ev(groupId, pa, {
      type: 'WaiveProposed',
      targetId: late.id,
      voters: [pa, pb],
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    await a.push([late, live, expired]);

    const [first] = await a.push([ev(groupId, pa, { type: 'WaiveVoted', proposalId: live.id, vote: 'approve' })]);
    expect(first?.error).toBeUndefined();
    const [again] = await a.push([ev(groupId, pa, { type: 'WaiveVoted', proposalId: live.id, vote: 'reject' })]);
    expect(again?.error).toBe('already_voted');
    const [notVoter] = await b.push([ev(groupId, pb, { type: 'WaiveVoted', proposalId: live.id, vote: 'approve' })]);
    expect(notVoter?.error).toMatch(/not_a_voter/);
    const [late_] = await b.push([ev(groupId, pb, { type: 'WaiveVoted', proposalId: expired.id, vote: 'approve' })]);
    expect(late_?.error).toMatch(/proposal_expired/);
  });

  it.skipIf(!SERVICE)('retraction: only the recorder, within 10 server minutes', async () => {
    const { a, b, groupId, pa, pb } = await setup();
    const fresh = ev(groupId, pa, { type: 'LateRecorded', playerId: pb });
    const old = ev(groupId, pa, { type: 'LateRecorded', playerId: pb });
    await a.push([fresh, old]);
    const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false }, realtime: { transport: WebSocket as never } });
    const { error } = await admin
      .from('events')
      .update({ server_at: new Date(Date.now() - 11 * 60_000).toISOString() })
      .eq('id', old.id);
    expect(error).toBeNull();

    const [byOther] = await b.push([ev(groupId, pb, { type: 'LateRetracted', targetId: fresh.id })]);
    expect(byOther?.error).toMatch(/not_recorder/);
    const [tooLate] = await a.push([ev(groupId, pa, { type: 'LateRetracted', targetId: old.id })]);
    expect(tooLate?.error).toMatch(/retract_window_closed/);
    const [inTime] = await a.push([ev(groupId, pa, { type: 'LateRetracted', targetId: fresh.id })]);
    expect(inTime?.error).toBeUndefined();
  });

  it('redemption undo: recorder only', async () => {
    const { a, b, groupId, pa, pb } = await setup();
    const redeem = ev(groupId, pb, { type: 'CupsRedeemed', debtorId: pb, payerId: pb, count: 1, recipients: [pa] });
    await b.push([redeem]);
    const [byOther] = await a.push([ev(groupId, pa, { type: 'RedemptionReverted', redemptionId: redeem.id })]);
    expect(byOther?.error).toMatch(/not_recorder/);
    const [own] = await b.push([ev(groupId, pb, { type: 'RedemptionReverted', redemptionId: redeem.id })]);
    expect(own?.error).toBeUndefined();
  });

  it('evidence photos: members upload and read, outsiders cannot', async () => {
    const { a, b, groupId } = await setup();
    const blob = new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'image/webp' });
    const id = await createSupabaseAssets(a.client).put(groupId, blob);
    expect(await createSupabaseAssets(b.client).url(groupId, id)).toMatch(/^http/);
    const outsider = remote();
    await outsider.ensureSession();
    await expect(createSupabaseAssets(outsider.client).put(groupId, blob)).rejects.toThrow();
    const { data } = await outsider.client.storage.from('evidence').download(`${groupId}/${id}.webp`);
    expect(data).toBeNull();
  });

  it('RLS: outsiders read nothing and nobody writes tables directly', async () => {
    const { a, groupId } = await setup();
    const outsider = remote();
    await outsider.ensureSession();
    expect(await outsider.pull(groupId, 0)).toEqual([]);
    expect(await outsider.inviteCode(groupId)).toBeNull();
    const { error } = await a.client.from('events').insert({ id: uid(), group_id: groupId, actor_id: 'x', type: 'x', body: {}, client_at: new Date().toISOString() });
    expect(error).not.toBeNull();
    const { error: updateError, count } = await a.client.from('events').update({ type: 'hacked' }, { count: 'exact' }).eq('group_id', groupId);
    expect(updateError !== null || count === 0).toBe(true);
  });

  it('realtime: members receive inserts live', async () => {
    const { a, b, groupId, pa, pb } = await setup();
    const received: LedgerEvent[] = [];
    let subscribed!: () => void;
    const ready = new Promise<void>((r) => (subscribed = r));
    const stop = b.subscribe(groupId, (e) => received.push(...e), (s) => s === 'subscribed' && subscribed());
    await ready;
    const late = ev(groupId, pa, { type: 'LateRecorded', playerId: pb });
    await a.push([late]);
    const arrived = () => received.find((e) => e.id === late.id);
    for (let i = 0; i < 50 && !arrived(); i++) await new Promise((r) => setTimeout(r, 100));
    stop();
    // Earlier inserts may be delivered too; the store merges by id, so only arrival matters.
    expect(arrived()).toMatchObject({ id: late.id, seq: expect.any(Number), serverAt: expect.any(String) });
    expect(received.every((e) => e.groupId === groupId)).toBe(true);
  }, 15_000);
});

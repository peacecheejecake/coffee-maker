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

/** Date in Seoul (the default group timezone), `days` from today. */
const seoulDate = (days = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + days * 86_400_000));

const joined = (groupId: string, id: string, role = 'member') =>
  ev(groupId, id, { type: 'PlayerJoined', player: { id, name: id, role, appearance: { color: '#000' }, archived: false } });

/** A non-anonymous account (the local stack confirms email sign-ups immediately), standing in for Google. */
async function signedIn() {
  const r = remote();
  const { error } = await r.client.auth.signUp({ email: `${uid()}@example.test`, password: 'password-1234' });
  if (error) throw new Error(error.message);
  return r;
}

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
    expect((await a.claimedPlayers(groupId)).map((c) => c.playerId).sort()).toEqual([pa, pb].sort());
    expect(await b.inviteCode(groupId)).toBe(inviteCode);
  });

  it('append_events: seq + server time, idempotent, owner-only rules, no impersonation', async () => {
    const { a, b, groupId, pa, pb } = await setup();
    const rules = ev(groupId, pa, { type: 'RulesetChanged', ruleset: { timezone: 'Asia/Seoul' }, effectiveFrom: '2026-10-23' });
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

  it('push subscriptions: own rows only; anonymous accounts report themselves', async () => {
    const { a, b, groupId } = await setup();
    const sub = { endpoint: `https://push.example/${uid()}`, keys: { p256dh: 'p', auth: 'x' } };
    await a.savePushSubscription(groupId, sub);
    await a.savePushSubscription(groupId, sub); // upsert
    expect((await a.client.from('push_subscriptions').select('endpoint')).data).toEqual([{ endpoint: sub.endpoint }]);
    expect((await b.client.from('push_subscriptions').select('endpoint')).data).toEqual([]);
    const outsiderSub = { ...sub, endpoint: `${sub.endpoint}x` };
    const outsider = remote();
    await outsider.ensureSession();
    await expect(outsider.savePushSubscription(groupId, outsiderSub)).rejects.toThrow(/not_member/);
    // The same browser endpoint registered by another account moves to that account.
    await b.savePushSubscription(groupId, sub);
    expect((await a.client.from('push_subscriptions').select('endpoint')).data).toEqual([]);
    expect((await b.client.from('push_subscriptions').select('endpoint')).data).toEqual([{ endpoint: sub.endpoint }]);
    await b.savePushSubscription(groupId, { ...sub, endpoint: `${sub.endpoint}-a` });
    await b.deletePushSubscription(sub.endpoint);
    await a.savePushSubscription(groupId, sub);
    await a.deletePushSubscription(sub.endpoint);
    expect((await a.client.from('push_subscriptions').select('endpoint')).data).toEqual([]);
    expect(await a.account()).toMatchObject({ anonymous: true });
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
    // Realtime delivery can take a few seconds on a busy local stack, and the first change-feed
    // subscription after a fresh `supabase start` takes longer still (the app's pull-on-subscribe covers that gap).
    for (let i = 0; i < 250 && !arrived(); i++) await new Promise((r) => setTimeout(r, 100));
    stop();
    // Earlier inserts may be delivered too; the store merges by id, so only arrival matters.
    expect(arrived()).toMatchObject({ id: late.id, seq: expect.any(Number), serverAt: expect.any(String) });
    expect(received.every((e) => e.groupId === groupId)).toBe(true);
  }, 35_000);

  it('modes: owner-only switches; the owner role moves to a claimed player only', async () => {
    const { a, b, groupId, pa, pb } = await setup();
    const [byMember] = await b.push([ev(groupId, pb, { type: 'ModeChanged', mode: 'attendance' })]);
    expect(byMember?.error).toMatch(/owner_only/);
    const [unknown] = await a.push([ev(groupId, pa, { type: 'OwnerTransferred', to: 'nobody' })]);
    expect(unknown?.error).toMatch(/no_such_player/);
    // In the ledger but no account behind it.
    const pc = uid();
    await a.push([ev(groupId, pa, { type: 'PlayerJoined', player: { id: pc, name: pc, role: 'member', appearance: { color: '#000' }, archived: false } })]);
    const [unclaimed] = await a.push([ev(groupId, pa, { type: 'OwnerTransferred', to: pc })]);
    expect(unclaimed?.error).toMatch(/not_claimed/);

    const [handed] = await a.push([ev(groupId, pa, { type: 'OwnerTransferred', to: pb })]);
    expect(handed?.error).toBeUndefined();
    // Roles moved on the server too: the old owner is refused, the new one accepted.
    const [old] = await a.push([ev(groupId, pa, { type: 'ModeChanged', mode: 'attendance' })]);
    expect(old?.error).toMatch(/owner_only/);
    const [now] = await b.push([ev(groupId, pb, { type: 'ModeChanged', mode: 'attendance' })]);
    expect(now?.error).toBeUndefined();
  });

  it('attendance: check-ins for the server today only, once; missed days once over, canonical and idempotent', async () => {
    const { a, b, groupId, pa, pb } = await setup();
    const [tomorrow] = await b.push([ev(groupId, pb, { type: 'CheckedIn', workDate: seoulDate(1) })]);
    expect(tomorrow?.error).toMatch(/wrong_day/);
    const [first] = await b.push([ev(groupId, pb, { type: 'CheckedIn', workDate: seoulDate() })]);
    expect(first?.error).toBeUndefined();
    const [again] = await b.push([ev(groupId, pb, { type: 'CheckedIn', workDate: seoulDate() })]);
    expect(again?.error).toMatch(/already_checked_in/);

    const today = { type: 'AttendanceMissed', playerId: pb, workDate: seoulDate() };
    const [early] = await a.push([{ ...ev(groupId, pa, today), id: `miss:${groupId}:${pb}:${seoulDate()}` } as LedgerEvent]);
    expect(early?.error).toMatch(/day_not_over/);

    const body = { type: 'AttendanceMissed', playerId: pb, workDate: seoulDate(-1) };
    const [bad] = await a.push([ev(groupId, pa, body)]);
    expect(bad?.error).toMatch(/bad_missed_id/);
    const id = `miss:${groupId}:${pb}:${seoulDate(-1)}`;
    // Two devices settling the same day at the same moment: both get the one stored row.
    const [[fromA], [fromB]] = await Promise.all([
      a.push([{ ...ev(groupId, pa, body), id } as LedgerEvent]),
      b.push([{ ...ev(groupId, pb, body), id } as LedgerEvent]),
    ]);
    expect(fromA).toMatchObject({ id, seq: expect.any(Number) });
    expect(fromB).toEqual(fromA);
  });

  it('modes: the server follows mode and adoption; adopted rules change only by motion', async () => {
    const { a, groupId, pa } = await setup();
    const ruleset = { timezone: 'Asia/Seoul' };
    const [notYet] = await a.push([ev(groupId, pa, { type: 'RulesAdopted', ruleset })]);
    expect(notYet?.error).toMatch(/wrong_mode/);
    await a.push([ev(groupId, pa, { type: 'ModeChanged', mode: 'attendance' })]);
    const [same] = await a.push([ev(groupId, pa, { type: 'ModeChanged', mode: 'attendance' })]);
    expect(same?.error).toMatch(/no_change/);
    const [badTz] = await a.push([ev(groupId, pa, { type: 'RulesAdopted', ruleset: { timezone: 'Not/AZone' } })]);
    expect(badTz?.error).toMatch(/invalid_timezone/);
    const [adopted] = await a.push([ev(groupId, pa, { type: 'RulesAdopted', ruleset })]);
    expect(adopted?.error).toBeUndefined();
    const [twice] = await a.push([ev(groupId, pa, { type: 'RulesAdopted', ruleset })]);
    expect(twice?.error).toMatch(/already_adopted/);
    const [direct] = await a.push([ev(groupId, pa, { type: 'RulesetChanged', ruleset, effectiveFrom: seoulDate() })]);
    expect(direct?.error).toMatch(/wrong_mode/);
  });

  it('motions: voters only, once, before the deadline; only the proposer withdraws', async () => {
    const { a, b, groupId, pa, pb } = await setup();
    const motion = { kind: 'adjust', playerId: pa, delta: 1, reason: 'x' };
    const open = ev(groupId, pa, { type: 'MotionProposed', motion, voters: [pb], expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const closed = ev(groupId, pa, { type: 'MotionProposed', motion, voters: [pb], expiresAt: new Date(Date.now() - 1_000).toISOString() });
    await a.push([open, closed]);

    const [notVoter] = await a.push([ev(groupId, pa, { type: 'MotionVoted', motionId: open.id, vote: 'approve' })]);
    expect(notVoter?.error).toMatch(/not_a_voter/);
    const [late] = await b.push([ev(groupId, pb, { type: 'MotionVoted', motionId: closed.id, vote: 'approve' })]);
    expect(late?.error).toMatch(/proposal_expired/);
    const [vote] = await b.push([ev(groupId, pb, { type: 'MotionVoted', motionId: open.id, vote: 'approve' })]);
    expect(vote?.error).toBeUndefined();
    const [twice] = await b.push([ev(groupId, pb, { type: 'MotionVoted', motionId: open.id, vote: 'reject' })]);
    expect(twice?.error).toMatch(/already_voted/);
    const [steal] = await b.push([ev(groupId, pb, { type: 'MotionWithdrawn', motionId: open.id })]);
    expect(steal?.error).toMatch(/not_proposer/);
  });

  it('invite links: anyone can watch read-only and live; members get their player back', async () => {
    const { a, b, groupId, pa, pb, inviteCode } = await setup();
    const viewer = remote();
    await viewer.ensureSession();
    expect(await viewer.viewGroup(inviteCode)).toEqual({ groupId, member: false, playerId: null });
    expect((await viewer.pull(groupId, 0)).length).toBeGreaterThanOrEqual(2);
    expect(await viewer.inviteCode(groupId)).toBe(inviteCode);
    // Watching is not taking part.
    expect((await viewer.push([ev(groupId, pa, { type: 'LateRecorded', playerId: pb })]))[0]!.error).toMatch(/not_actor/);
    expect(await b.viewGroup(inviteCode)).toEqual({ groupId, member: true, playerId: pb });
    await expect(viewer.viewGroup('NOPE0000')).rejects.toThrow(/invalid_invite/);
    expect(await a.myGroups()).toMatchObject([{ groupId, role: 'owner', playerId: pa, inviteCode }]);
    expect(await viewer.myGroups()).toEqual([]);
  });

  it('accounts: list their groups; a signed-in account can take over a name held by an anonymous one', async () => {
    const { groupId, pb, inviteCode } = await setup();
    expect(await remote().account()).toBeNull();
    const g = await signedIn();
    expect(await g.account()).toMatchObject({ anonymous: false, email: expect.stringContaining('@') });
    await g.joinGroup(inviteCode);
    expect(await g.claimedPlayers(groupId)).toContainEqual({ playerId: pb, anonymous: true });
    await g.claimPlayer(groupId, pb);
    expect(await g.claimedPlayers(groupId)).toContainEqual({ playerId: pb, anonymous: false });
    const [mine] = await g.myGroups();
    expect(mine).toMatchObject({ groupId, inviteCode, role: 'member', playerId: pb, playerName: pb, members: 3 });

    const anon = remote();
    await anon.ensureSession();
    await anon.joinGroup(inviteCode);
    const other = await signedIn();
    await other.joinGroup(inviteCode);
    await expect(anon.claimPlayer(groupId, pb)).rejects.toThrow(/player_taken/);
    await expect(other.claimPlayer(groupId, pb)).rejects.toThrow(/player_taken/);
  });
});

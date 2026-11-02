import type { GeoFix, GroupId, LedgerEvent, PlayerId } from '@coffee/core';

/** Device-local event log, per group. Implementations: in-memory (tests), IndexedDB (web). */
export interface EventStore {
  load(groupId: GroupId): Promise<LedgerEvent[]>;
  /** Adds events not stored yet (by id); existing ids are left alone. */
  append(events: readonly LedgerEvent[]): Promise<void>;
  /** Inserts or replaces by id — used to record the server's seq/serverAt once confirmed. */
  put(events: readonly LedgerEvent[]): Promise<void>;
  /** Drops events the server rejected. */
  remove(ids: readonly string[]): Promise<void>;
}

export interface PushResult {
  id: string;
  seq?: number;
  serverAt?: string;
  /** Server rejection reason, e.g. "proposal_expired". Absent when accepted. */
  error?: string;
}

export type RemoteStatus = 'connecting' | 'subscribed' | 'closed';

/** Server side of sync (Supabase in production, a fake in tests). */
export interface RemoteSync {
  ensureSession(): Promise<void>;
  createGroup(input: { groupId: GroupId; playerId: PlayerId; name: string }): Promise<{ inviteCode: string }>;
  /** Becomes a member (participant) of the group behind an invite code. Idempotent. */
  joinGroup(code: string): Promise<{ groupId: GroupId; playerId: PlayerId | null }>;
  /** Opens an invite link without joining: members get their membership back, everyone else becomes a viewer. */
  viewGroup(code: string): Promise<{ groupId: GroupId; member: boolean; playerId: PlayerId | null }>;
  claimPlayer(groupId: GroupId, playerId: PlayerId): Promise<void>;
  /** Players already bound to an account. Ones held by an anonymous account can be taken over after signing in. */
  claimedPlayers(groupId: GroupId): Promise<PlayerClaim[]>;
  /** Groups the signed-in account belongs to, newest first. */
  myGroups(): Promise<GroupSummary[]>;
  inviteCode(groupId: GroupId): Promise<string | null>;
  push(events: readonly LedgerEvent[]): Promise<PushResult[]>;
  /** Confirmed events with seq greater than `afterSeq`, in seq order. */
  pull(groupId: GroupId, afterSeq: number): Promise<LedgerEvent[]>;
  subscribe(groupId: GroupId, onEvents: (events: LedgerEvent[]) => void, onStatus: (s: RemoteStatus) => void): () => void;
  savePushSubscription(groupId: GroupId, subscription: PushSubscriptionData): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;
  /** APNs/FCM device token from the native shell. */
  saveNativePushToken(groupId: GroupId, token: string, platform: 'ios' | 'android'): Promise<void>;
  deleteNativePushToken(token: string): Promise<void>;
  /** The current session's account; null when there is no session yet. Local, works offline. */
  account(): Promise<Account | null>;
  /** Starts an OAuth redirect that signs in (switching accounts); the browser comes back to `returnTo`. */
  signIn(provider: 'google', returnTo: string): Promise<void>;
  signOut(): Promise<void>;
  /** Starts an OAuth redirect that attaches a provider identity to the current (anonymous) user. */
  linkAccount(provider: 'google' | 'apple'): Promise<void>;
}

/** Anonymous accounts vanish with the browser's data; a signed-in account can be used on any device. */
export interface Account {
  id: string;
  anonymous: boolean;
  email?: string;
}

export interface PlayerClaim {
  playerId: PlayerId;
  /** Held by an anonymous account: a signed-in account may take it over. */
  anonymous: boolean;
}

export interface GroupSummary {
  groupId: GroupId;
  /** Set at creation to the creator's name. */
  name: string;
  inviteCode: string;
  role: 'owner' | 'member';
  playerId: PlayerId | null;
  playerName: string | null;
  members: number;
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** What a device registered for push: a Web Push subscription, or a native APNs/FCM token. */
export type PushRegistration =
  | ({ kind: 'web' } & PushSubscriptionData)
  | { kind: 'native'; token: string; platform: 'ios' | 'android' };

/** Push plumbing injected by the app shell: Web Push in browsers, APNs/FCM in the native shell. */
export interface PushPort {
  supported(): boolean;
  permission(): NotificationPermission | 'unsupported';
  subscribe(): Promise<PushRegistration | null>;
  /** Returns what was removed, if anything. */
  unsubscribe(): Promise<PushRegistration | null>;
  /** Identifier of the current registration (endpoint or token), if any. */
  current(): Promise<string | null>;
}

/** Small device-local settings: active group, who is using this device, UI tone. */
export interface MetaStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export type LocateFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';
export type LocateResult = { ok: true; fix: GeoFix } | { ok: false; reason: LocateFailure };

/**
 * One foreground position reading (the browser Geolocation API, also inside the native shell's web view).
 * Nothing here runs in the background: see docs/DESIGN.md §2.7 for why there is no geofencing.
 */
export interface GeolocationPort {
  supported(): boolean;
  /** A fresh-enough reading; the first call may show the permission prompt. Never rejects. */
  current(): Promise<LocateResult>;
}

/** Evidence photos for redemptions (receipts, the coffee itself). */
export interface AssetStore {
  /** Stores an already-compressed image and returns its id. */
  put(groupId: GroupId, blob: Blob): Promise<string>;
  /** A URL the UI can show, or null if the asset is unavailable. */
  url(groupId: GroupId, assetId: string): Promise<string | null>;
}

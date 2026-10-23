import type { GroupId, LedgerEvent, PlayerId } from '@coffee/core';

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
  joinGroup(code: string): Promise<{ groupId: GroupId; playerId: PlayerId | null }>;
  claimPlayer(groupId: GroupId, playerId: PlayerId): Promise<void>;
  /** Players already bound to an account, so a newcomer can't pick them. */
  claimedPlayers(groupId: GroupId): Promise<PlayerId[]>;
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
  /** Anonymous accounts vanish with the browser's data; linking makes them recoverable. */
  account(): Promise<{ anonymous: boolean; email?: string }>;
  /** Starts an OAuth redirect that attaches a provider identity to the current (anonymous) user. */
  linkAccount(provider: 'google' | 'apple'): Promise<void>;
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

/** Evidence photos for redemptions (receipts, the coffee itself). */
export interface AssetStore {
  /** Stores an already-compressed image and returns its id. */
  put(groupId: GroupId, blob: Blob): Promise<string>;
  /** A URL the UI can show, or null if the asset is unavailable. */
  url(groupId: GroupId, assetId: string): Promise<string | null>;
}

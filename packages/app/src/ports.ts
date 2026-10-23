import type { GroupId, LedgerEvent } from '@coffee/core';

/** Append-only event log, per group. Implementations: in-memory (tests), IndexedDB (web), remote (M3). */
export interface EventStore {
  load(groupId: GroupId): Promise<LedgerEvent[]>;
  append(events: readonly LedgerEvent[]): Promise<void>;
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

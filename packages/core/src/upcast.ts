import { CURRENT_SCHEMA_VERSION, type LedgerEvent } from './events';

export type RawEvent = { type: string; schemaVersion: number } & Record<string, unknown>;
export type Upcaster = (e: RawEvent) => RawEvent;
/** upcasters[type][fromVersion] converts an event of `fromVersion` into `fromVersion + 1`. */
export type UpcasterRegistry = Record<string, Record<number, Upcaster>>;

export const upcasters: UpcasterRegistry = {};

/**
 * Brings a stored event up to the current schema. Stored events are never rewritten;
 * this runs on load. Versions without a registered upcaster are assumed compatible.
 */
export function upcast(
  raw: RawEvent,
  registry: UpcasterRegistry = upcasters,
  current: number = CURRENT_SCHEMA_VERSION,
): LedgerEvent {
  if (raw.schemaVersion > current) {
    throw new Error(`Event ${String(raw.id)} has schema v${raw.schemaVersion}; this build supports up to v${current}`);
  }
  let e = raw;
  while (e.schemaVersion < current) {
    const step = registry[e.type]?.[e.schemaVersion];
    e = { ...(step ? step(e) : e), schemaVersion: e.schemaVersion + 1 };
  }
  return e as unknown as LedgerEvent;
}

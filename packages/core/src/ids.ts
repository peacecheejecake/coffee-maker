declare const brand: unique symbol;

/** Nominal typing for string identifiers so different ID kinds cannot be mixed up. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type PlayerId = Brand<string, 'PlayerId'>;
/** ULID generated on the client; doubles as the idempotency key when syncing. */
export type EventId = Brand<string, 'EventId'>;
export type GroupId = Brand<string, 'GroupId'>;

export const asPlayerId = (v: string): PlayerId => v as PlayerId;
export const asEventId = (v: string): EventId => v as EventId;
export const asGroupId = (v: string): GroupId => v as GroupId;

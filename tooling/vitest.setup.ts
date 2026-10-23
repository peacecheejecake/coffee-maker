// Node 18 has no global Web Crypto (browsers and Node 20+ do). Provide it for tests.
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

// Node 18 also lacks CustomEvent (used by Dexie on close).
if (!globalThis.CustomEvent) {
  class NodeCustomEvent<T> extends Event {
    readonly detail: T;
    constructor(type: string, init?: CustomEventInit<T>) {
      super(type, init);
      this.detail = init?.detail as T;
    }
  }
  Object.defineProperty(globalThis, 'CustomEvent', { value: NodeCustomEvent });
}

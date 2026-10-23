const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * ULID: 48-bit millisecond timestamp + 80 random bits, Crockford base32. Lexicographically sortable by
 * creation time, generated offline on any device, so it doubles as the sync idempotency key.
 */
export function ulid(now: number = Date.now(), random: (bytes: Uint8Array) => Uint8Array = fillRandom): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(new Uint8Array(10));
  let rand = '';
  // 80 bits → 16 base32 chars, 5 bits at a time.
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      rand += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return time + rand;
}

const fillRandom = (bytes: Uint8Array) => crypto.getRandomValues(bytes);

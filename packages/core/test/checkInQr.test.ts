import { createHash, getRandomValues } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkInCodeHash,
  checkInLink,
  checkInQrFor,
  DEFAULT_RULESET,
  isValidRuleset,
  matchesCheckInQr,
  newCheckInCode,
  parseCheckInQr,
  validateRuleset,
  type GeoFix,
  type Workplace,
} from '../src';
import { sha256Hex } from '../src/sha256';
import { A, B, C, createLedger, type Ledger } from './harness';

const random = (b: Uint8Array) => getRandomValues(b);
const CODE = 'ABCDEFGHJKLMNPQRSTUV';
const OTHER = 'ZZZZZZZZZZZZZZZZZZZZ';

describe('sha256', () => {
  it('matches node for ASCII, multi-block and non-ASCII input', () => {
    for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(300), '출두✓😀']) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
});

describe('check-in codes', () => {
  it('are 20 characters without look-alikes, and differ each time', () => {
    const a = newCheckInCode(random);
    expect(a).toMatch(/^[A-HJ-NP-Z2-9]{20}$/);
    expect(newCheckInCode(random)).not.toBe(a);
  });

  it('only the hash goes into the rules, and only the same code matches it', () => {
    const qr = checkInQrFor(CODE);
    expect(JSON.stringify(qr)).not.toContain(CODE);
    expect(qr.codeHash).toBe(checkInCodeHash(CODE));
    expect(matchesCheckInQr(qr, CODE)).toBe(true);
    expect(matchesCheckInQr(qr, OTHER)).toBe(false);
    expect(matchesCheckInQr(qr, undefined)).toBe(false);
    expect(matchesCheckInQr(qr, CODE.toLowerCase())).toBe(false);
  });

  it('are read from a check-in link on any origin, or bare; anything else is not one', () => {
    expect(parseCheckInQr(checkInLink('https://coffee.example', CODE))).toBe(CODE);
    expect(parseCheckInQr(`https://a.b/?x=1&checkin=${CODE}#top`)).toBe(CODE);
    expect(parseCheckInQr(` ${CODE}\n`)).toBe(CODE);
    expect(parseCheckInQr(`https://a.b/?checkin=${CODE}X`)).toBeNull();
    expect(parseCheckInQr('https://example.com/menu')).toBeNull();
    expect(parseCheckInQr('')).toBeNull();
  });

  it('a ruleset with a malformed QR is invalid', () => {
    expect(validateRuleset({ ...DEFAULT_RULESET, checkInQr: checkInQrFor(CODE) })).toEqual([]);
    expect(isValidRuleset({ ...DEFAULT_RULESET, checkInQr: { codeHash: CODE } })).toBe(false);
    expect(isValidRuleset({ ...DEFAULT_RULESET, checkInQr: 'x' })).toBe(false);
  });
});

/** A, B, C in attendance mode with the QR required, adopted Fri 10-23; the clock is Mon 10-26 08:50. */
function withQr(extra: { workplace?: Workplace } = {}): Ledger {
  const l = createLedger();
  l.join(A, B, C);
  l.claim(B, C);
  l.run(A, { type: 'ChangeMode', mode: 'attendance' });
  l.run(A, { type: 'AdoptRules', ruleset: { ...DEFAULT_RULESET, ...extra, checkInQr: checkInQrFor(CODE) } });
  l.advanceMinutes(3 * 24 * 60 - 10);
  l.setToday('2026-10-26');
  return l;
}

describe('check-in with the QR', () => {
  it('needs the scanned code, and the event never carries it', () => {
    const l = withQr();
    expect(l.fail(B, { type: 'CheckIn' }).code).toBe('QrRequired');
    expect(l.fail(B, { type: 'CheckIn', qrCode: OTHER }).code).toBe('QrMismatch');
    expect(l.fail(B, { type: 'CheckIn', qrCode: 'not a code' }).code).toBe('QrMismatch');
    const [e] = l.run(B, { type: 'CheckIn', qrCode: CODE });
    expect(e).toMatchObject({ type: 'CheckedIn', workDate: '2026-10-26' });
    expect(JSON.stringify(e)).not.toContain(CODE);
  });

  it('goes with the workplace: both must pass', () => {
    const office: Workplace = { lat: 37.5665, lng: 126.978, radiusMeters: 150 };
    const at = (dLat: number): GeoFix => ({ lat: office.lat + dLat, lng: office.lng, accuracyMeters: 20 });
    const l = withQr({ workplace: office });
    expect(l.fail(B, { type: 'CheckIn', position: at(0) }).code).toBe('QrRequired');
    expect(l.fail(B, { type: 'CheckIn', qrCode: CODE }).code).toBe('LocationRequired');
    expect(l.fail(B, { type: 'CheckIn', qrCode: CODE, position: at(0.01) }).code).toBe('OutsideWorkplace');
    l.run(B, { type: 'CheckIn', qrCode: CODE, position: at(0) });
  });

  it('a new QR replaces the old one by motion; turning it off frees check-ins', () => {
    const l = withQr();
    const [p] = l.run(B, { type: 'ProposeMotion', motion: { kind: 'ruleset', ruleset: { ...DEFAULT_RULESET, checkInQr: checkInQrFor(OTHER) } } });
    l.run(A, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' });
    l.run(C, { type: 'VoteMotion', motionId: p!.id, vote: 'approve' });
    expect(l.fail(B, { type: 'CheckIn', qrCode: CODE }).code).toBe('QrMismatch');
    l.run(B, { type: 'CheckIn', qrCode: OTHER });

    const [q] = l.run(C, { type: 'ProposeMotion', motion: { kind: 'ruleset', ruleset: DEFAULT_RULESET } });
    l.run(A, { type: 'VoteMotion', motionId: q!.id, vote: 'approve' });
    l.run(B, { type: 'VoteMotion', motionId: q!.id, vote: 'approve' });
    l.run(C, { type: 'CheckIn' });
  });

  it('without the QR in the rules, a scanned code is simply not needed', () => {
    const l = createLedger();
    l.join(A);
    l.run(A, { type: 'ChangeMode', mode: 'attendance' });
    l.run(A, { type: 'AdoptRules', ruleset: DEFAULT_RULESET });
    l.advanceMinutes(3 * 24 * 60 - 10);
    l.setToday('2026-10-26');
    l.run(A, { type: 'CheckIn', qrCode: CODE });
  });
});

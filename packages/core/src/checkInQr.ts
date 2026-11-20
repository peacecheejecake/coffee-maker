/**
 * The check-in QR (출두 QR): a printed code that must be scanned to check in, e.g. to tell the office floor from
 * the lobby café that shares its coordinates.
 *
 * The rules keep only the code's SHA-256, so the app can never show the QR again: nobody can screenshot it from a
 * colleague's settings. The printed sheet is the only copy. Like the workplace, this is checked on the device and
 * never stored in events (docs/DESIGN.md §2.8).
 */
import { sha256Hex } from './sha256';

export interface CheckInQr {
  /** SHA-256 (lowercase hex) of the code printed in the QR. */
  codeHash: string;
}

/** The query parameter that carries the code when the QR is a link (opens the app from the phone's camera). */
export const CHECKIN_QR_PARAM = 'checkin';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 20;
const CODE_RE = /^[A-Z2-9]{20}$/;

export const isCheckInCode = (v: unknown): v is string => typeof v === 'string' && CODE_RE.test(v);

/** A new random code (100 bits). `random` fills a byte array, e.g. `crypto.getRandomValues`. */
export function newCheckInCode(random: (bytes: Uint8Array) => Uint8Array): string {
  const bytes = random(new Uint8Array(CODE_LENGTH));
  // 256 is a multiple of 32, so taking the low 5 bits is unbiased.
  return Array.from(bytes, (b) => CODE_ALPHABET[b & 31]).join('');
}

export const checkInCodeHash = (code: string): string => sha256Hex(`coffee-maker/checkin/${code}`);

export const checkInQrFor = (code: string): CheckInQr => ({ codeHash: checkInCodeHash(code) });

export const matchesCheckInQr = (qr: CheckInQr, code: string | undefined): boolean =>
  isCheckInCode(code) && checkInCodeHash(code) === qr.codeHash;

/** What the QR encodes: a link into the app, so the phone's own camera can open it too. */
export const checkInLink = (origin: string, code: string): string => `${origin}/?${CHECKIN_QR_PARAM}=${code}`;

/** The code in scanned text: a check-in link from any origin, or the bare code. Null for anything else. */
export function parseCheckInQr(text: string): string | null {
  const s = text.trim();
  if (isCheckInCode(s)) return s;
  const m = new RegExp(`[?&]${CHECKIN_QR_PARAM}=([A-Z2-9]{20})(?:&|#|$)`).exec(s);
  return m ? m[1]! : null;
}

export const isCheckInQr = (v: unknown): v is CheckInQr =>
  typeof v === 'object' && v !== null && /^[0-9a-f]{64}$/.test((v as CheckInQr).codeHash ?? '');

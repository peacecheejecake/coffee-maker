import { plainKo } from './plain.ko';
import { underworldKo, type MessageKey, type Messages } from './underworld.ko';

export type { MessageKey, Messages };
export type Tone = 'underworld' | 'plain';

export const MESSAGES: Record<Tone, Messages> = { underworld: underworldKo, plain: plainKo };

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** `t('record.done', { name: '민수', cups: 1 })` → "민수에게 업보 1잔이 청구되었습니다" */
export function createTranslator(tone: Tone): Translate {
  const messages = MESSAGES[tone];
  return (key, params) =>
    messages[key].replace(/\{(\w+)\}/g, (m, name: string) => (params && name in params ? String(params[name]) : m));
}

/** Korean particle helper: 을/를, 이/가, 은/는, 과/와 depending on whether the word ends in a final consonant. */
export function josa(word: string, pair: '을/를' | '이/가' | '은/는' | '과/와'): string {
  const last = word.charCodeAt(word.length - 1);
  const hasFinal = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  const [withFinal, without] = pair.split('/') as [string, string];
  return word + (hasFinal ? withFinal : without);
}

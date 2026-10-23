import { describe, expect, it } from 'vitest';
import { createTranslator, josa, MESSAGES } from '../src';

describe('theme', () => {
  it('interpolates parameters and leaves unknown placeholders', () => {
    const t = createTranslator('underworld');
    expect(t('record.done', { name: '민수', cups: 2 })).toBe('민수에게 업보 2잔이 청구되었습니다');
    expect(t('record.done')).toBe('{name}에게 업보 {cups}잔이 청구되었습니다');
  });

  it('every tone has every key, non-empty', () => {
    const keys = Object.keys(MESSAGES.underworld);
    for (const messages of Object.values(MESSAGES)) {
      expect(Object.keys(messages).sort()).toEqual([...keys].sort());
      for (const k of keys) expect(messages[k as keyof typeof messages].length).toBeGreaterThan(0);
    }
  });

  it('plain tone changes wording', () => {
    expect(createTranslator('plain')('action.record')).toBe('지각 기록');
  });

  it('picks the right particle', () => {
    expect(josa('민수', '이/가')).toBe('민수가');
    expect(josa('지원', '이/가')).toBe('지원이');
    expect(josa('Sam', '은/는')).toBe('Sam는');
  });
});

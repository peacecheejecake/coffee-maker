import { describe, expect, it } from 'vitest';
import { FONT_URL, FULL_FONT_URL, fontFor } from '../src/fonts';

describe('fontFor', () => {
  it('uses the subset for common Korean names and ASCII', () => {
    expect(fontFor('민수')).toBe(FONT_URL);
    expect(fontFor('Jiwon 99')).toBe(FONT_URL);
  });

  it('falls back to the full font for syllables outside KS X 1001', () => {
    // '똠' and '햏' are not among the 2,350 common syllables.
    expect(fontFor('똠양꿍')).toBe(FULL_FONT_URL);
    expect(fontFor('햏자')).toBe(FULL_FONT_URL);
  });
});

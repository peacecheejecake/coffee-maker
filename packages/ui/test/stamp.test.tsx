import { describe, expect, it } from 'vitest';
import { gaugeAt, STAMP, stampQuality } from '../src/stamp';

describe('stamp', () => {
  it('gauge fills in fillSeconds and overfills up to max', () => {
    expect(gaugeAt(0)).toBe(0);
    expect(gaugeAt(STAMP.fillSeconds)).toBe(1);
    expect(gaugeAt(100)).toBe(STAMP.max);
  });

  it.each([
    [0.2, 'faint'],
    [0.59, 'faint'],
    [0.6, 'clean'],
    [0.85, 'clean'],
    [0.86, 'smudged'],
    [1.3, 'smudged'],
  ])('gauge %f → %s', (g, q) => {
    expect(stampQuality(g)).toBe(q);
  });
});

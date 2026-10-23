import { describe, expect, it } from 'vitest';
import { flatten, par, seq, step, TimelineRun, wait } from '../src/director/timeline';

describe('timeline', () => {
  it('composes seq/par/wait into absolute cue times', () => {
    const t = seq(step('a', 1), par(step('b', 0.5), seq(wait(0.2), step('c', 1))), false, step('d', 0.3));
    const { cues, duration } = flatten(t);
    expect(cues.map((c) => [c.name, c.at])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 1.2],
      ['d', 2.2],
    ]);
    expect(duration).toBeCloseTo(2.5);
  });

  it('fires starts and ends in time order and reports completion', () => {
    const log: string[] = [];
    const s = (name: string, d: number) =>
      step<string[]>(name, d, { start: (l) => l.push(`+${name}`), end: (l) => l.push(`-${name}`) });
    const { cues, duration } = flatten(seq(s('a', 1), par(s('b', 1), s('c', 0.5))));
    const run = new TimelineRun(cues, duration);
    expect(run.advance(0, log)).toBe(false);
    expect(log).toEqual(['+a']);
    expect(run.advance(1.6, log)).toBe(false);
    expect(log).toEqual(['+a', '-a', '+b', '+c', '-c']);
    expect(run.advance(2, log)).toBe(true);
    expect(log.at(-1)).toBe('-b');
  });

  it('skipping to the end fires everything exactly once', () => {
    const log: string[] = [];
    const { cues, duration } = flatten(
      seq(step<string[]>('x', 1, { start: (l) => l.push('+x'), end: (l) => l.push('-x') }), wait(5)),
    );
    const run = new TimelineRun(cues, duration);
    expect(run.advance(Infinity, log)).toBe(true);
    expect(run.advance(Infinity, log)).toBe(true);
    expect(log).toEqual(['+x', '-x']);
  });
});

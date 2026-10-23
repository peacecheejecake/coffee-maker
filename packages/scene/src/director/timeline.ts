/**
 * Tiny timeline DSL (PLAN.md M4). A timeline is built from steps with fixed durations, composed with
 * seq/par/wait, and flattened into cues with absolute start times. Pure data + callbacks: the director
 * decides *what* happens, the runner decides *when*.
 */
export interface Cue<C> {
  name: string;
  /** Seconds from the start of the timeline. */
  at: number;
  duration: number;
  start?: (ctx: C) => void;
  end?: (ctx: C) => void;
}

export interface Node<C> {
  duration: number;
  /** Emits cues shifted by `offset`. */
  emit(offset: number, out: Cue<C>[]): void;
}

export function step<C>(
  name: string,
  duration: number,
  hooks: { start?: (ctx: C) => void; end?: (ctx: C) => void } = {},
): Node<C> {
  return {
    duration,
    emit: (offset, out) => out.push({ name, at: offset, duration, ...hooks }),
  };
}

export const wait = <C>(duration: number): Node<C> => ({ duration, emit: () => {} });

export function seq<C>(...nodes: (Node<C> | false | null | undefined)[]): Node<C> {
  const list = nodes.filter((n): n is Node<C> => !!n);
  return {
    duration: list.reduce((d, n) => d + n.duration, 0),
    emit(offset, out) {
      let t = offset;
      for (const n of list) {
        n.emit(t, out);
        t += n.duration;
      }
    },
  };
}

export function par<C>(...nodes: (Node<C> | false | null | undefined)[]): Node<C> {
  const list = nodes.filter((n): n is Node<C> => !!n);
  return {
    duration: list.reduce((d, n) => Math.max(d, n.duration), 0),
    emit(offset, out) {
      for (const n of list) n.emit(offset, out);
    },
  };
}

/** Cues sorted by start time (stable), plus the total length. */
export function flatten<C>(node: Node<C>): { cues: Cue<C>[]; duration: number } {
  const cues: Cue<C>[] = [];
  node.emit(0, cues);
  return { cues: cues.map((c, i) => ({ c, i })).sort((a, b) => a.c.at - b.c.at || a.i - b.i).map((x) => x.c), duration: node.duration };
}

/**
 * Advances a flattened timeline to `elapsed` seconds, firing every start/end whose time has come, in order.
 * Returns true when the whole timeline has finished. Calling with Infinity skips to the end.
 */
export class TimelineRun<C> {
  private started = new Set<number>();
  private ended = new Set<number>();
  constructor(
    readonly cues: Cue<C>[],
    readonly duration: number,
  ) {}

  advance(elapsed: number, ctx: C): boolean {
    // Interleaved by time. At the same instant, ends fire before starts (a sequence hands over cleanly),
    // except a zero-length cue, which must start before it ends.
    const due: { t: number; i: number; kind: 'start' | 'end' }[] = [];
    this.cues.forEach((c, i) => {
      if (!this.started.has(i) && c.at <= elapsed) due.push({ t: c.at, i, kind: 'start' });
      if (!this.ended.has(i) && c.at + c.duration <= elapsed) due.push({ t: c.at + c.duration, i, kind: 'end' });
    });
    due.sort((a, b) => {
      if (a.t !== b.t) return a.t - b.t;
      if (a.i === b.i) return a.kind === 'start' ? -1 : 1;
      if (a.kind !== b.kind) return a.kind === 'end' ? -1 : 1;
      return a.i - b.i;
    });
    for (const d of due) {
      const cue = this.cues[d.i]!;
      if (d.kind === 'start') {
        this.started.add(d.i);
        cue.start?.(ctx);
      } else {
        this.ended.add(d.i);
        cue.end?.(ctx);
      }
    }
    return this.ended.size === this.cues.length && elapsed >= this.duration;
  }
}

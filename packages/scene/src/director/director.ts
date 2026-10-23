import type { Matrix4 } from 'three';
import type { SceneEvent } from '../model';
import type { FxState, Vec3 } from './fx';
import { flatten, par, seq, step, wait as waitFor, type Node } from './timeline';

export interface DirectorEnv {
  /** World position just above a tower's current stack top. */
  towerTop(towerId: string): Vec3;
  /** World position of a tower's pedestal centre. */
  towerBase(towerId: string): Vec3;
  /** Where a cup sits in the (new) layout, world space. */
  cupTarget(cupId: string): Matrix4 | undefined;
  /** Last place a cup was drawn (for cups that just left the model). */
  cupLastSeen(cupId: string): Matrix4 | undefined;
  towerColor(towerId: string): string;
  /** Where the reaper sends bills from. */
  deskOut: Vec3;
  sfx(name: string): void;
}

export interface FxContext {
  fx: FxState;
  env: DirectorEnv;
}

type N = Node<FxContext>;
const wait = (seconds: number): N => waitFor<FxContext>(seconds);

let burstSeq = 0;
const burst = (ctx: FxContext, kind: FxState['bursts'][number]['kind'], pos: Vec3) =>
  ctx.fx.bursts.push({ id: `b${++burstSeq}`, kind, pos, t0: ctx.fx.now, seed: burstSeq });

const focus = (towerId: string): N =>
  step('focus', 0.45, { start: (c) => void (c.fx.focus = towerId) });
const unfocus = (): N => step('unfocus', 0, { start: (c) => void (c.fx.focus = null) });
const reaper = (action: NonNullable<FxState['reaper']>['action'], duration = 0.5, sfx?: string): N =>
  step(`reaper:${action}`, duration, {
    start: (c) => {
      c.fx.reaper = { action, t0: c.fx.now };
      if (sfx) c.env.sfx(sfx);
    },
  });

/** Bill flies from the desk to above the tower, poofs, and a cup drops onto the stack. */
function billAndDrop(towerId: string, cupId: string, index: number): N {
  const billId = `bill:${cupId}`;
  const dropId = `drop:${cupId}`;
  return seq(
    wait(index * 0.15),
    step('bill', 0.55, {
      start: (c) => {
        const top = c.env.towerTop(towerId);
        c.fx.flyers.set(billId, {
          id: billId,
          kind: 'bill',
          color: c.env.towerColor(towerId),
          from: c.env.deskOut,
          to: [top[0], top[1] + 2.2, top[2]],
          arc: 1.6,
          t0: c.fx.now,
          duration: 0.55,
        });
        c.env.sfx('whoosh');
      },
      end: (c) => {
        c.fx.flyers.delete(billId);
        const top = c.env.towerTop(towerId);
        burst(c, 'smoke', [top[0], top[1] + 2.2, top[2]]);
      },
    }),
    step('drop', 0.42, {
      start: (c) => {
        const target = c.env.cupTarget(cupId);
        const top = c.env.towerTop(towerId);
        const to: Vec3 = target ? [target.elements[12], target.elements[13], target.elements[14]] : top;
        c.fx.flyers.set(dropId, {
          id: dropId,
          kind: 'cup',
          color: c.env.towerColor(towerId),
          from: [to[0], top[1] + 2.2, to[2]],
          to,
          arc: 0,
          t0: c.fx.now,
          duration: 0.42,
        });
      },
      end: (c) => {
        c.fx.flyers.delete(dropId);
        c.fx.landed.add(cupId);
        c.fx.landings.set(cupId, c.fx.now);
        c.fx.impacts.set(towerId, c.fx.now);
        const target = c.env.cupTarget(cupId);
        if (target) burst(c, 'splash', [target.elements[12], target.elements[13] + 1, target.elements[14]]);
        c.env.sfx('drop');
      },
    }),
  );
}

function removal(cupIds: string[], style: 'evaporate' | 'gold' | 'ascend'): N {
  return par(
    ...cupIds.map((cupId, i) =>
      seq(
        wait(i * 0.08),
        step(`leave:${style}`, 0.9, {
          start: (c) => {
            c.fx.removalStarted.add(cupId);
            const matrix = c.env.cupLastSeen(cupId);
            if (!matrix) return;
            c.fx.leaving.set(cupId, { cupId, matrix, color: '#999', style, t0: c.fx.now, duration: 0.9 });
            if (style === 'gold') burst(c, 'gold', [matrix.elements[12], matrix.elements[13] + 0.5, matrix.elements[14]]);
          },
          end: (c) => void c.fx.leaving.delete(cupId),
        }),
      ),
    ),
  );
}

export interface DirectOptions {
  /** prefers-reduced-motion: no flights or wobble, just quick appear/fade. */
  reduced?: boolean;
  /** Many events queued (e.g. a sync catch-up): skip camera moves and the reaper's flourish. */
  compact?: boolean;
}

/** Scene event → timeline (DESIGN.md §4.1). */
export function direct(event: SceneEvent, opts: DirectOptions = {}): N {
  const { reduced = false, compact = false } = opts;
  switch (event.kind) {
    case 'cupsAdded': {
      if (reduced) {
        return step('appear', 0.25, {
          end: (c) => event.cupIds.forEach((id) => c.fx.landed.add(id)),
        });
      }
      const drops = par(...event.cupIds.map((id, i) => billAndDrop(event.towerId, id, i)));
      if (compact) return drops;
      return seq(focus(event.towerId), reaper('stamp', 0.45, 'stamp'), drops, wait(0.9), unfocus());
    }
    case 'cupsRemoved': {
      if (reduced) {
        return step('fade', 0.25, { start: (c) => event.cupIds.forEach((id) => c.fx.removalStarted.add(id)) });
      }
      const leave = removal(event.cupIds, event.style);
      if (compact) return leave;
      return seq(
        focus(event.towerId),
        event.style === 'gold' ? reaper('gavel', 0.7, 'gavel') : reaper('reject', 0.4),
        leave,
        wait(0.5),
        unfocus(),
      );
    }
    case 'onTime':
      return seq(
        reaper('pen', reduced ? 0 : 0.6),
        step('sparkle', reduced ? 0 : 0.8, {
          start: (c) => {
            if (reduced) return;
            const b = c.env.towerBase(event.towerId);
            burst(c, 'sparkle', [b[0], b[1] + 0.6, b[2]]);
            c.env.sfx('sparkle');
          },
        }),
      );
    case 'gradeChanged':
      return step('flip', reduced ? 0 : 0.6, { start: (c) => void (reduced || c.fx.flips.set(event.towerId, c.fx.now)) });
    case 'verdict':
      // Approval shows through the gold removal; a rejection gets its own stamp.
      if (event.outcome !== 'rejected' || reduced) return wait(0);
      return seq(
        compact ? null : focus(event.towerId),
        reaper('stamp', 0.45, 'stamp'),
        step('stamp-burst', 0.6, {
          start: (c) => {
            const t = c.env.towerTop(event.towerId);
            burst(c, 'stamp', [t[0], t[1] - 0.5, t[2] + 0.5]);
          },
        }),
        compact ? null : unfocus(),
      );
    case 'rulesChanged':
      return reduced ? wait(0) : reaper('stamp', 0.6, 'stamp');
  }
}

export const timelineFor = (event: SceneEvent, opts?: DirectOptions) => flatten(direct(event, opts));

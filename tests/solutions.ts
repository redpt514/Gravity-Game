import type { ActionResult, Game, TimedAction } from '../src/sim/types.ts';
import { playTimeline } from '../src/sim/game.ts';

/**
 * Reference timed solutions for the handcrafted levels (t = game seconds). They must clear on the default seed and
 * seeds 1-8. Board geometry: the gas current runs counter-clockwise on screen (top flows left, bottom flows right),
 * so a wall across the top or bottom half dams it and gas piles up on the upstream side.
 */
export interface Solution { level: number; note: string; timeline: TimedAction[] }

const wallTop = { type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 } as const;
const wallBottom = { type: 'place', tool: 'wall', x: 80, y: 90, x2: 80, y2: 45 } as const;
/** Repulsor just upstream/below the top pile: squeezes the dammed gas up into the body there. */
const squeezeTop = { type: 'place', tool: 'repulsor', x: 105, y: 15 } as const;
/** Lens on the top pile's star: holds it and feeds it 1.8x. */
const lensTop = { type: 'place', tool: 'lens', x: 90, y: 22 } as const;

export const SOLUTIONS: Solution[] = [
  {
    level: 1,
    note: 'One repulsor in each current (top and bottom, x=80) pinches it against the board edge; a cloud forms upstream.',
    timeline: [
      { t: 0, action: { type: 'place', tool: 'repulsor', x: 80, y: 22 } },
      { t: 0, action: { type: 'place', tool: 'repulsor', x: 80, y: 68 } },
    ],
  },
  {
    level: 2,
    note: 'Dam both currents at x=80 with long walls: one pile (and cloud) on each upstream side, both grow to planets.',
    timeline: [{ t: 0, action: wallTop }, { t: 0, action: wallBottom }],
  },
  {
    level: 3,
    note: 'Dam the top current; at 15 s a repulsor under/upstream of the pile squeezes gas into the planet so it ignites.',
    timeline: [{ t: 0, action: wallTop }, { t: 15, action: squeezeTop }],
  },
  {
    level: 4,
    note: 'Level 3 line, then a lens on the star at 35 s keeps it fed so it burns hot enough for the helium.',
    timeline: [{ t: 0, action: wallTop }, { t: 15, action: squeezeTop }, { t: 35, action: lensTop }],
  },
  {
    level: 5,
    note: 'Same line: the lens-fed star passes 250 mass, goes red giant (C+O) and explodes.',
    timeline: [{ t: 0, action: wallTop }, { t: 15, action: squeezeTop }, { t: 35, action: lensTop }],
  },
];

/** Play a solution until every goal deadline has passed (or `untilSec`), stopping early once cleared. */
export function replay(g: Game, timeline: TimedAction[], untilSec?: number): ActionResult[] {
  const last = Math.max(...g.state().level.goals.map((x) => x.deadlineSec));
  return playTimeline(g, timeline, { untilSec: untilSec ?? last, stopWhenCleared: true });
}

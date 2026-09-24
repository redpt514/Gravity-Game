import type { Action, ActionResult, Game } from '../src/sim/types.ts';
import { applyActions } from '../src/sim/game.ts';

/** Apply a solution's actions (endRound = run a round), stopping once the level is won or lost. */
export function replay(g: Game, actions: Action[]): ActionResult[] {
  const out: ActionResult[] = [];
  for (const a of actions) {
    const ph = g.state().phase;
    if (ph === 'won' || ph === 'lost') break;
    out.push(...applyActions(g, [a]));
  }
  return out;
}

/**
 * Reference scripted solutions. Replay with replaySolution() (or applyActions, stopping once won):
 * each {"type":"endRound"} runs one full round. They must win on the default seed and seeds 1-8.
 * Board geometry: the gas current runs counter-clockwise on screen (top flows left, bottom flows right),
 * so a wall across the top or bottom half dams it and gas piles up on the upstream side.
 */
export interface Solution { level: number; note: string; actions: Action[] }

const wallTop: Action = { type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 };
const wallBottom: Action = { type: 'place', tool: 'wall', x: 80, y: 90, x2: 80, y2: 45 };
/** Repulsor just upstream/below the top pile: squeezes the dammed gas up into the body there. */
const squeezeTop: Action = { type: 'place', tool: 'repulsor', x: 105, y: 15 };
/** Lens on the top pile's star: holds it and feeds it 1.8x. */
const lensTop: Action = { type: 'place', tool: 'lens', x: 90, y: 22 };
const end: Action = { type: 'endRound' };

export const SOLUTIONS: Solution[] = [
  {
    level: 1,
    note: 'One repulsor in each current (top and bottom, x=80) pinches it against the board edge; a cloud forms upstream.',
    actions: [
      { type: 'place', tool: 'repulsor', x: 80, y: 22 },
      { type: 'place', tool: 'repulsor', x: 80, y: 68 },
      end, end,
    ],
  },
  {
    level: 2,
    note: 'Dam both currents at x=80 with long walls: one pile (and cloud) on each upstream side, both grow to planets.',
    actions: [wallTop, wallBottom, end, end, end],
  },
  {
    level: 3,
    note: 'Dam the top current; round 2 a repulsor under/upstream of the pile squeezes gas into the planet so it ignites.',
    actions: [wallTop, end, squeezeTop, end, end],
  },
  {
    level: 4,
    note: 'Level 3 line (star by round 2), then round 3 a lens on the star keeps it fed so it burns hot enough for the helium.',
    actions: [wallTop, end, squeezeTop, end, lensTop, end, end],
  },
  {
    level: 5,
    note: 'Same line: the lens-fed star passes 250 mass, goes red giant (C+O) and explodes.',
    actions: [wallTop, end, squeezeTop, end, lensTop, end, end, end],
  },
];

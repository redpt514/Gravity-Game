import type { Action } from '../src/sim/types.ts';

/**
 * Reference scripted solutions (default level seeds). Replay with applyActions(createGame(level), actions):
 * there, each {"type":"endRound"} runs one full round. Each list ends on the round the level is won.
 * Board geometry: the gas current runs counter-clockwise on screen (top flows left, bottom flows right),
 * so a wall across the top or bottom half dams it and gas piles up on the upstream side.
 */
export interface Solution { level: number; note: string; actions: Action[] }

const wallTop: Action = { type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 };
const wallBottom: Action = { type: 'place', tool: 'wall', x: 80, y: 90, x2: 80, y2: 45 };
const end: Action = { type: 'endRound' };

export const SOLUTIONS: Solution[] = [
  {
    level: 1,
    note: 'Two repulsors side by side across the centre squeeze the gas between them; a cloud forms early in round 1.',
    actions: [
      { type: 'place', tool: 'repulsor', x: 62, y: 45 },
      { type: 'place', tool: 'repulsor', x: 98, y: 45 },
      end,
    ],
  },
  {
    level: 2,
    note: 'Round 1: dam the top current with a wall -> 1 cloud upstream (right of it). Round 2: dam the bottom current too -> second pile/cloud; clouds grow to a planet.',
    actions: [wallTop, end, wallBottom, end],
  },
  {
    level: 3,
    note: 'Dam both currents at x=80 (two piles). Round 2: a lens at (66,56) pulls the lower pile and its bodies together into one star.',
    actions: [wallTop, wallBottom, end, { type: 'place', tool: 'lens', x: 66, y: 56 }, end, end],
  },
  {
    level: 4,
    note: 'Dam both currents and fire a pulse into the upstream top pile to shock out several clouds; round 2 lens at (100,20) merges them into a star that fuses He.',
    actions: [
      wallTop, wallBottom, { type: 'place', tool: 'pulse', x: 110, y: 20 }, end,
      { type: 'place', tool: 'lens', x: 100, y: 20 }, end, end,
    ],
  },
  {
    level: 5,
    note: 'Same opening as level 4; the lens-fed star passes 250 mass, goes red giant (C+O) and explodes.',
    actions: [
      wallTop, wallBottom, { type: 'place', tool: 'pulse', x: 110, y: 20 }, end,
      { type: 'place', tool: 'lens', x: 100, y: 20 }, end, end,
    ],
  },
];

import type { ToolDef, ToolId } from './types.ts';
import { P } from './params.ts';

/**
 * Tool catalogue. Costs are tuned so a level's starting energy affords 2-3 repulsors.
 * strength is a potential amplitude: negative repels, positive attracts.
 */
export const TOOL_DEFS: Record<ToolId, ToolDef> = {
  repulsor: {
    id: 'repulsor', name: 'Repulsor',
    description: 'Permanent anti-gravity node: pushes particles out of a circle, piling them up at its rim.',
    cost: 30, radius: 16, strength: -2, durationRounds: null, unlockLevel: 1,
  },
  wall: {
    id: 'wall', name: 'Wall',
    description: 'Permanent anti-gravity segment (drag x,y to x2,y2, max 50 long): herds particles like a fence.',
    cost: 35, radius: 5, strength: -6, durationRounds: null, unlockLevel: 2,
  },
  lens: {
    id: 'lens', name: 'Lens',
    description: 'Permanent attractor: gathers particles and bodies toward its centre. Expensive.',
    cost: 55, radius: 18, strength: 3, durationRounds: null, unlockLevel: 3,
  },
  pulse: {
    id: 'pulse', name: 'Pulse',
    description: 'Strong one-round radial push that fades over the round, then vanishes.',
    cost: 25, radius: 20, strength: -4, durationRounds: 1, unlockLevel: 4,
  },
  black_hole: {
    id: 'black_hole', name: 'Black Hole',
    description: 'Huge gravity well that swallows particles and bodies near its core and grows.',
    cost: 150, radius: 22, strength: 6, durationRounds: null, unlockLevel: 6,
  },
  red_matter: {
    id: 'red_matter', name: 'Red Matter',
    description: 'Instantly collapses the first cloud or planet that touches it into a star, then is spent.',
    cost: 120, radius: 6, strength: 1, durationRounds: null, unlockLevel: 6,
  },
};

/** Max wall length in world units. */
export const WALL_MAX_LEN = P.wallMaxLen;

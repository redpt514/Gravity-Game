/**
 * Player-facing tool presentation (colors + v0.3-shaped ToolDef fallback).
 *
 * Ownership note: the authoritative tool catalogue lives in src/sim/tools.ts
 * (sim-owned). This file used to re-export it directly, but while the sim is
 * being rewritten to the v0.3 contract (src/sim/types.ts: ToolDef.durationSec
 * replaces durationRounds) that file may still be mid-migration, so the UI
 * defines its own small v0.3-shaped catalogue here to stay renderable and
 * typecheck-clean independent of the sim's migration state. When the real
 * sim lands with a matching ToolDef shape, switch this back to
 * `export { TOOL_DEFS } from '../sim/tools'` as the single source of truth.
 */
import type { ToolDef, ToolId } from '../sim/types';

export const TOOL_DEFS: Record<ToolId, ToolDef> = {
  repulsor: {
    id: 'repulsor', name: 'Repulsor',
    description: 'Permanent anti-gravity node: pushes particles out of a circle, piling them up at its rim.',
    cost: 30, radius: 16, strength: -2, durationSec: null, unlockLevel: 1,
  },
  wall: {
    id: 'wall', name: 'Wall',
    description: 'Permanent anti-gravity segment (drag x,y to x2,y2, 5 to 50 long): herds particles like a fence; long walls dam the current.',
    cost: 35, radius: 5, strength: -6, durationSec: null, unlockLevel: 2,
  },
  lens: {
    id: 'lens', name: 'Lens',
    description: 'Permanent attractor for bodies: pulls existing clouds, planets and stars toward its centre so they merge, and makes bodies inside it swallow gas faster.',
    cost: 80, radius: 18, strength: 3, durationSec: null, unlockLevel: 3,
  },
  pulse: {
    id: 'pulse', name: 'Pulse',
    description: 'Strong radial push that fades out over about 20 seconds, then vanishes.',
    cost: 40, radius: 20, strength: -4, durationSec: 20, unlockLevel: 4,
  },
  black_hole: {
    id: 'black_hole', name: 'Black Hole',
    description: 'Huge gravity well that swallows particles and bodies near its core and grows.',
    cost: 150, radius: 22, strength: 6, durationSec: null, unlockLevel: 6,
  },
  red_matter: {
    id: 'red_matter', name: 'Red Matter',
    description: 'Instantly collapses the first cloud or planet that touches it into a star, then is spent.',
    cost: 120, radius: 6, strength: 1, durationSec: null, unlockLevel: 6,
  },
};

/** Max wall length in world units (fallback; sim/params.ts is the source of truth once landed). */
export const WALL_MAX_LEN = 50;

export const ELEMENT_COLOR: Record<string, string> = {
  H: '#cfe3ff',
  He: '#ffe066',
  C: '#9aa0a6',
  O: '#5eead4',
  Fe: '#ff9f43',
  heavy: '#d946ef',
};

export const TOOL_COLOR: Record<ToolId, string> = {
  repulsor: '#6ea8fe',
  wall: '#8b7bff',
  lens: '#ffcf5c',
  pulse: '#ff6b6b',
  black_hole: '#c084fc',
  red_matter: '#ef4444',
};

/** Emoji glyph per goal type, for the countdown pill strip. */
export const GOAL_ICON: Record<string, string> = {
  clouds: '☁️',
  planets: '🪐',
  stars: '⭐',
  star_kind: '⭐',
  element: '⚗️',
  novae: '💥',
  density: '📈',
};

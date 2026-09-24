/**
 * Player-facing tool presentation (colors) plus a re-export of the sim's own
 * TOOL_DEFS (src/sim/tools.ts) so the palette, node radius previews and
 * placement validity all read the same cost/radius numbers the simulation
 * actually uses. Only used as a fallback (see mockGame.ts) before that file
 * existed; kept here now as the single import point for the rest of render/ui.
 */
import type { ToolId } from '../sim/types';

export { TOOL_DEFS } from '../sim/tools';

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

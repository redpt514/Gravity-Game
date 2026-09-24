import type { BodyKind, GameState, Goal } from '../sim/types.ts';

const STARS: BodyKind[] = ['star_ms', 'star_giant', 'white_dwarf', 'neutron'];

/** Current progress value of a goal against state (compare with goal.count). */
export function goalValue(s: GameState, g: Goal, maxDensity = 0): number {
  switch (g.type) {
    case 'clouds': return s.bodies.length;
    case 'planets': return s.bodies.filter((b) => b.kind !== 'cloud').length;
    case 'stars': return s.bodies.filter((b) => STARS.includes(b.kind)).length;
    case 'star_kind': return s.bodies.filter((b) => b.kind === g.kind).length;
    case 'element': {
      const els = g.els ?? (g.el ? [g.el] : []);
      let t = 0;
      for (const e of els) t += s.scoreboard.elements[e];
      return Math.floor(t);
    }
    case 'novae': return s.scoreboard.novae;
    case 'density': return Math.round(maxDensity * 100) / 100;
  }
}

/** Refresh s.goals current/met. Met is latched: once achieved it stays achieved. */
export function evaluateGoals(s: GameState, maxDensity = 0): void {
  for (const gs of s.goals) {
    gs.current = goalValue(s, gs.goal, maxDensity);
    if (gs.current >= gs.goal.count) gs.met = true;
  }
}

export type Verdict = 'won' | 'lost' | 'continue';

/** Called at the end of round `round` (after evaluateGoals). */
export function judge(s: GameState, round: number): Verdict {
  if (s.goals.some((g) => !g.met && g.goal.byRound <= round)) return 'lost';
  if (s.goals.every((g) => g.met)) return 'won';
  if (round >= s.level.rounds) return 'lost';
  return 'continue';
}

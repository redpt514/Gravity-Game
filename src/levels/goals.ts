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

export interface GoalChange { index: number; kind: 'met' | 'missed' }

/**
 * Refresh s.goals at the current game time: current values, countdowns, latching.
 * A goal is met the first time current >= count (latched, metAt recorded, countdown frozen);
 * an unmet goal whose countdown reaches 0 is marked missed but can still be met later.
 */
export function updateGoals(s: GameState, maxDensity = 0): GoalChange[] {
  const out: GoalChange[] = [];
  s.goals.forEach((gs, index) => {
    gs.current = goalValue(s, gs.goal, maxDensity);
    if (gs.met) return;
    gs.remainingSec = Math.max(0, gs.goal.deadlineSec - s.time);
    if (gs.current >= gs.goal.count) {
      gs.met = true; gs.metAt = s.time;
      out.push({ index, kind: 'met' });
    } else if (gs.remainingSec <= 0 && !gs.missed) {
      gs.missed = true;
      out.push({ index, kind: 'missed' });
    }
  });
  return out;
}

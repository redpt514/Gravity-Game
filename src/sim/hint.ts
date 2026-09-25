/**
 * Hint engine: picks the most urgent unmet goal, proposes a few concrete placements from heuristics
 * (dam the current past the biggest body, squeeze gas into it, lens the body nearest its next threshold,
 * pinch the current, block the densest stream, ...), plays each one forward on a CLONE of the world for a
 * short horizon, and returns the one that most improves that goal's progress. Deterministic in the state;
 * never mutates the live world. Only suggests tools the player can use right now (palette/inventory + energy).
 */
import type { Action, BodyKind, GameState, Goal, Hint, ToolId } from './types.ts';
import { P } from './params.ts';
import { TOOL_DEFS } from './tools.ts';
import { Frame } from './frame.ts';
import { KIND_LABEL, canCondenseAt } from './bodies.ts';
import { worldOf, type World } from './world.ts';
import { goalValue } from '../levels/goals.ts';
import type { Game } from './types.ts';

/** Total lookahead ticks for a 3000-particle level (~1 ms each in node; scaled by particle count), split over the candidates. */
export const HINT_TICK_BUDGET = 240;
export const HINT_MAX_CANDIDATES = 4;

const STAR_KINDS: BodyKind[] = ['star_ms', 'star_giant', 'white_dwarf', 'neutron'];

/** Goal progress as a continuous number: integer part = goal value, fraction = how close the next unit is. */
export function goalProgress(s: GameState, g: Goal): number {
  const w = worldOf(s);
  const v = goalValue(s, g, w?.maxDensity ?? 0);
  const frac = (x: number) => Math.max(0, Math.min(0.99, x));
  let best = 0;
  switch (g.type) {
    case 'clouds': {
      const th = s.cloudThreshold ?? 1;
      return v + frac((w?.maxDensity ?? 0) / th);
    }
    case 'planets':
      for (const b of s.bodies) if (b.kind === 'cloud') best = Math.max(best, b.mass / P.planetMass);
      return v + frac(best);
    case 'stars':
      for (const b of s.bodies) if (b.kind === 'cloud' || b.kind === 'planet') best = Math.max(best, b.mass / P.starMass);
      return v + frac(best);
    case 'star_kind':
      for (const b of s.bodies) {
        if (b.kind === g.kind) continue;
        if (b.kind === 'cloud' || b.kind === 'planet') best = Math.max(best, 0.5 * b.mass / P.starMass);
        else if (b.kind === 'star_ms' || b.kind === 'star_giant') best = Math.max(best, 0.5 + 0.5 * b.progress);
      }
      return v + frac(best);
    case 'element': {
      // produced so far + what the current stars will make in the next ~10 s (fusion ~ m^2)
      let rate = 0;
      for (const b of s.bodies) if (b.kind === 'star_ms' || b.kind === 'star_giant') rate += P.fusionK * b.mass * b.mass;
      const els = g.els ?? (g.el ? [g.el] : []);
      let t = 0;
      for (const e of els) t += s.scoreboard.elements[e];
      return t + rate * 300;
    }
    case 'novae':
      for (const b of s.bodies) {
        if (b.kind === 'star_giant') best = Math.max(best, 0.5 + 0.5 * b.progress * Math.min(1, b.mass / P.novaMass));
        else if (!STAR_KINDS.includes(b.kind) && b.kind !== 'black_hole') best = Math.max(best, 0.5 * Math.min(1, b.mass / P.novaMass));
        else if (b.kind === 'white_dwarf') best = Math.max(best, 0.5 * b.mass / P.wdNovaMass);
      }
      return v + frac(best);
    case 'density':
      return v;
  }
}

/** Index of the most urgent unmet goal: least time left per unit of progress still needed. */
export function urgentGoal(s: GameState): number {
  let bi = -1, bs = Infinity;
  s.goals.forEach((gs, i) => {
    if (gs.met) return;
    const need = Math.max(0.05, 1 - Math.min(1, goalProgress(s, gs.goal) / Math.max(1e-9, gs.goal.count)));
    const score = gs.remainingSec / need;
    if (score < bs) { bs = score; bi = i; }
  });
  return bi;
}

interface Cand { tool: ToolId; x: number; y: number; x2?: number; y2?: number; reason: string }

function candidates(s: GameState, goal: Goal, usable: Set<ToolId>): Cand[] {
  const f = new Frame(s.width, s.height, s.level.swirl ?? 1);
  const L = f.L, S = f.S;
  const cu = (u: number) => Math.min(L - 3, Math.max(3, u)), cv = (v: number) => Math.min(S - 3, Math.max(3, v));
  const out: Cand[] = [];
  const add = (tool: ToolId, u: number, v: number, reason: string, u2?: number, v2?: number) => {
    if (!usable.has(tool)) return;
    const a = f.toBoard(cu(u), cv(v));
    const c: Cand = { tool, x: r1(a.x), y: r1(a.y), reason };
    if (u2 !== undefined && v2 !== undefined) {
      const b = f.toBoard(Math.min(L, Math.max(0, u2)), Math.min(S, Math.max(0, v2)));
      const a0 = f.toBoard(Math.min(L, Math.max(0, u)), Math.min(S, Math.max(0, v)));
      c.x = r1(a0.x); c.y = r1(a0.y); c.x2 = r1(b.x); c.y2 = r1(b.y);
    }
    if (out.some((o) => o.tool === c.tool && Math.hypot(o.x - c.x, o.y - c.y) < 6)) return;
    out.push(c);
  };
  // bodies in the canonical frame
  const bodies = s.bodies.filter((b) => b.kind !== 'neutron' && b.kind !== 'black_hole').map((b) => ({ b, ...f.toCanon(b.x, b.y) }));
  const big = bodies.reduce<(typeof bodies)[number] | null>((m, x) => (!m || x.b.mass > m.b.mass ? x : m), null);
  // body nearest its next mass threshold
  const next = (m: number) => (m < P.planetMass ? P.planetMass : m < P.starMass ? P.starMass : m < P.novaMass ? P.novaMass : P.wdNovaMass);
  const near = bodies.reduce<(typeof bodies)[number] | null>((m, x) => (!m || x.b.mass / next(x.b.mass) > m.b.mass / next(m.b.mass) ? x : m), null);
  // densest free gas where a cloud could condense
  const d = s.density;
  let dense: { u: number; v: number } | null = null;
  if (d) {
    let bk = -1;
    const cell = s.width / s.gridW;
    for (let k = 0; k < d.length; k++) {
      if (bk >= 0 && d[k] <= d[bk]) continue;
      if (!canCondenseAt(s, ((k % s.gridW) + 0.5) * cell, (Math.floor(k / s.gridW) + 0.5) * cell)) continue;
      bk = k;
    }
    if (bk >= 0) dense = f.toCanon(((bk % s.gridW) + 0.5) * cell, (Math.floor(bk / s.gridW) + 0.5) * cell);
  }
  const top = (v: number) => v < S / 2;
  const down = (v: number) => (top(v) ? -1 : 1); // downstream direction along u
  const damLen = Math.min(45, S / 2);
  const hasWall = (isTop: boolean) => s.nodes.some((n) => n.tool === 'wall' && top(f.toCanon((n.x + (n.x2 ?? n.x)) / 2, (n.y + (n.y2 ?? n.y)) / 2).v) === isTop);
  const growth = goal.type !== 'clouds' && goal.type !== 'density';
  const kname = (k: BodyKind) => KIND_LABEL[k].toLowerCase();

  const dam = () => {
    if (big && !hasWall(top(big.v))) {
      const u = big.u + down(big.v) * (big.b.radius + 6);
      if (top(big.v)) add('wall', u, 0, `Dam the current just past the ${kname(big.b.kind)} so the gas piles up into it`, u, damLen);
      else add('wall', u, S, `Dam the current just past the ${kname(big.b.kind)} so the gas piles up into it`, u, S - damLen);
    }
    if (!hasWall(true)) add('wall', L / 2, 0, 'Dam the top current with a wall: gas piles up on its upstream side and condenses', L / 2, damLen);
    else if (!hasWall(false)) add('wall', L / 2, S, 'Dam the other current too: a second pile makes a second cloud', L / 2, S - damLen);
  };
  const squeeze = () => {
    if (!big) return;
    const t = top(big.v);
    add('repulsor', big.u - down(big.v) * 20, t ? big.v + 10 : big.v - 10, `Squeeze the gas around the ${kname(big.b.kind)} into it with a repulsor on its upstream side`);
  };
  const lens = () => {
    if (!near) return;
    add('lens', near.u, near.v, `Lens the ${kname(near.b.kind)} (mass ${Math.round(near.b.mass)}): it pulls bodies in and feeds ${P.lensFeedMul}x faster`);
  };
  const pinch = () => {
    for (const v of [S / 4, (3 * S) / 4]) {
      const p = f.toBoard(L / 2, v);
      if (s.nodes.some((n) => n.tool === 'repulsor' && Math.hypot(n.x - p.x, n.y - p.y) < 10)) continue;
      add('repulsor', L / 2, v, 'Pinch the current against the edge with a repulsor: gas piles up just upstream of it');
      break;
    }
  };
  const block = () => {
    if (!dense) return;
    add('repulsor', dense.u + down(dense.v) * 14, dense.v, 'Block the densest gas stream just downstream so it piles up into a cloud');
  };
  const pulse = () => {
    if (!big) return;
    const t = top(big.v);
    add('pulse', big.u - down(big.v) * 16, t ? big.v + 14 : big.v - 14, `Pulse beside the ${kname(big.b.kind)} to shove the gas around it inward`);
  };
  const red = () => {
    const c = bodies.filter((x) => x.b.kind === 'cloud' || x.b.kind === 'planet').sort((a, b) => b.b.mass - a.b.mass)[0];
    if (c) add('red_matter', c.u, c.v, `Red matter on the ${kname(c.b.kind)} collapses it straight into a star`);
  };
  const order = growth
    ? (goal.type === 'stars' || goal.type === 'planets' ? [squeeze, dam, lens, red, pulse, block, pinch] : [lens, squeeze, dam, pulse, red, block, pinch])
    : [pinch, dam, block, squeeze, pulse];
  for (const fn of order) fn();
  return out;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Compute a hint for the live world `w`. `fork(w)` must return an independent Game on a deep copy.
 * Returns the hint (without cost/at) or a reason string when no hint can be given.
 */
export function computeHint(w: World, fork: (w: World) => Game): Omit<Hint, 'cost' | 'at'> | string {
  const s = w.s;
  const gi = urgentGoal(s);
  if (gi < 0) return 'all goals are met: nothing to suggest';
  const goal = s.goals[gi].goal;
  const usable = new Set<ToolId>();
  let cheapest: ToolId | null = null;
  for (const t of new Set<ToolId>([...s.level.tools, ...(Object.keys(s.inventory) as ToolId[])])) {
    const inv = s.inventory[t] ?? 0;
    if (!s.level.tools.includes(t) && inv <= 0) continue;
    if (inv > 0 || s.energy >= TOOL_DEFS[t].cost) usable.add(t);
    if (!cheapest || TOOL_DEFS[t].cost < TOOL_DEFS[cheapest].cost) cheapest = t;
  }
  if (usable.size === 0) {
    const c = cheapest ? TOOL_DEFS[cheapest].cost : 0;
    const wait = s.level.incomePerSec > 0 ? Math.ceil((c - s.energy) / s.level.incomePerSec) : Infinity;
    return `not enough energy for any tool yet (${cheapest} needs ${c}, about ${wait}s away)`;
  }
  const cands = candidates(s, goal, usable).slice(0, HINT_MAX_CANDIDATES);
  if (cands.length === 0) return 'no useful placement found with the tools you can afford right now';
  // relative tick cost vs a 3000-particle level (grid work is fixed, particle work scales)
  const perTick = 0.4 + 0.6 * (s.particles.length / 3000);
  const horizon = Math.max(30, Math.min(300, Math.floor(HINT_TICK_BUDGET / perTick / cands.length)));
  let best: { c: Cand; v: number } | null = null;
  for (const c of cands) {
    const g = fork(w);
    if (g.state().phase === 'intro') g.apply({ type: 'start' });
    const act: Action = { type: 'place', tool: c.tool, x: c.x, y: c.y, ...(c.x2 !== undefined ? { x2: c.x2, y2: c.y2 } : {}) };
    if (!g.apply(act).ok) continue;
    g.step(horizon);
    const v = goalProgress(g.state(), goal);
    if (!best || v > best.v + 1e-9) best = { c, v };
  }
  if (!best) return 'no valid placement found with the tools you can afford right now';
  const { c } = best;
  return { tool: c.tool, x: c.x, y: c.y, ...(c.x2 !== undefined ? { x2: c.x2, y2: c.y2 } : {}), reason: `${c.reason} (for "${goal.label}").`, goalIndex: gi };
}

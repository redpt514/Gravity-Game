/**
 * Heuristic player used to calibrate procedural levels (and handy for smoke tests).
 * It plays the reference lines of tests/solutions.ts generalised to any board: dam the gas current with a wall,
 * squeeze the pile into its body with a repulsor, then lens the biggest body so it keeps feeding.
 * Coordinates are planned in a canonical frame (u along the long edge, v across it, current along v=0 flowing
 * toward -u) and mapped to the board, so the same plan works on wide and tall boards and for reversed currents.
 */
import { createGame } from '../sim/game.ts';
import { TOOL_DEFS } from '../sim/tools.ts';
import { Frame } from '../sim/frame.ts';
import type { Action, Game, GameState, Goal, LevelDef, TimedAction, ToolId } from '../sim/types.ts';
import { TICKS_PER_SECOND } from '../sim/types.ts';
import { goalValue } from './goals.ts';

export interface BoardSize { width: number; height: number; gridW: number; gridH: number }

/** Tracked per second of game time (latched max over the samples up to then). */
export const METRICS = ['clouds', 'planets', 'stars', 'giants', 'dwarfs', 'He', 'CO', 'Fe', 'novae'] as const;
export type Metric = (typeof METRICS)[number];
export type Metrics = Record<Metric, number>;

/** The goal that `metric` measures (count, deadline and points are filled in by the caller). */
export function metricGoal(m: Metric): Omit<Goal, 'count' | 'deadlineSec' | 'points' | 'label'> {
  switch (m) {
    case 'clouds': return { type: 'clouds' };
    case 'planets': return { type: 'planets' };
    case 'stars': return { type: 'stars' };
    case 'giants': return { type: 'star_kind', kind: 'star_giant' };
    case 'dwarfs': return { type: 'star_kind', kind: 'white_dwarf' };
    case 'He': return { type: 'element', el: 'He' };
    case 'CO': return { type: 'element', els: ['C', 'O'] };
    case 'Fe': return { type: 'element', el: 'Fe' };
    case 'novae': return { type: 'novae' };
  }
}

const PROBES: { m: Metric; g: Goal }[] = METRICS.map((m) => ({ m, g: { ...metricGoal(m), count: 1, deadlineSec: 1, points: 0, label: m } as Goal }));

function sampleMetrics(s: GameState, into: Metrics): void {
  for (const { m, g } of PROBES) {
    const v = goalValue(s, g);
    if (v > into[m]) into[m] = v;
  }
}

export { Frame };

type Side = 'top' | 'bottom';
/** minRound r = not before (r-1) x ROUND_SEC seconds (the old round structure, kept as the bot's pacing). */
interface Item { tool: ToolId; minRound: number; at: (ctx: Ctx) => { u: number; v: number; u2?: number; v2?: number } | null }
interface Ctx { s: GameState; f: Frame }

const clampU = (c: Ctx, u: number) => Math.min(c.f.L - 3, Math.max(3, u));
const clampV = (c: Ctx, v: number) => Math.min(c.f.S - 3, Math.max(3, v));

/** Biggest body on one side of the board (canonical), or null. */
function biggest(c: Ctx, side: Side): { u: number; v: number; mass: number } | null {
  let best: { u: number; v: number; mass: number } | null = null;
  for (const b of c.s.bodies) {
    if (b.kind === 'neutron' || b.kind === 'black_hole') continue;
    const p = c.f.toCanon(b.x, b.y);
    if ((side === 'top') !== (p.v < c.f.S / 2)) continue;
    if (!best || b.mass > best.mass) best = { ...p, mass: b.mass };
  }
  return best;
}

// Items mirror the reference lines (board 160x90: wall (80,0)-(80,45), squeeze (105,15), lens (90,22)).
const dam = (side: Side): Item => ({
  tool: 'wall', minRound: 1,
  at: (c) => {
    const D = Math.min(45, c.f.S / 2);
    return side === 'top' ? { u: c.f.L / 2, v: 0, u2: c.f.L / 2, v2: D } : { u: c.f.L / 2, v: c.f.S, u2: c.f.L / 2, v2: c.f.S - D };
  },
});
const squeeze = (side: Side, du = 25, dv = 15, minRound = 2): Item => ({
  tool: 'repulsor', minRound,
  at: (c) => side === 'top' ? { u: clampU(c, c.f.L / 2 + du), v: dv } : { u: clampU(c, c.f.L / 2 - du), v: c.f.S - dv },
});
const lens = (side: Side, minRound = 3): Item => ({
  tool: 'lens', minRound,
  at: (c) => {
    const b = biggest(c, side);
    if (b) return { u: clampU(c, b.u), v: clampV(c, b.v) };
    return side === 'top' ? { u: c.f.L / 2 + 10, v: 22 } : { u: c.f.L / 2 - 10, v: c.f.S - 22 };
  },
});
const pinch = (side: Side): Item => ({
  tool: 'repulsor', minRound: 1,
  at: (c) => ({ u: c.f.L / 2, v: side === 'top' ? c.f.S / 4 : (3 * c.f.S) / 4 }),
});
/** Pulse just downstream-inside of the biggest body: shoves the surrounding gas into it for a round. */
const pulseFeed = (side: Side, minRound: number): Item => ({
  tool: 'pulse', minRound,
  at: (c) => {
    const b = biggest(c, side);
    if (!b) return null;
    return side === 'top' ? { u: clampU(c, b.u + 16), v: clampV(c, b.v + 14) } : { u: clampU(c, b.u - 16), v: clampV(c, b.v - 14) };
  },
});
const redMatter = (side: Side, minRound: number): Item => ({
  tool: 'red_matter', minRound,
  at: (c) => {
    const b = biggest(c, side);
    return b && b.mass < 120 ? { u: clampU(c, b.u), v: clampV(c, b.v) } : null;
  },
});

export const VARIANTS: Record<string, Item[]> = {
  /** one big star: the level 3-5 reference line, then feed it and start a second pile */
  single: [dam('top'), squeeze('top'), lens('top'), squeeze('top', 45, 12, 3), pulseFeed('top', 4), dam('bottom'), squeeze('bottom', 25, 15, 4), redMatter('bottom', 5), lens('bottom', 5), pulseFeed('top', 6)],
  /** two piles from round 1 (level 2 line), squeezed and lensed */
  twin: [dam('top'), dam('bottom'), squeeze('top'), squeeze('bottom'), lens('top'), redMatter('bottom', 3), lens('bottom', 4), pulseFeed('top', 5), pulseFeed('bottom', 6)],
  /** level 1 pinch for early clouds, then dam and feed the top pile */
  pinch: [pinch('top'), pinch('bottom'), dam('top'), squeeze('top', 25, 15, 3), lens('top'), redMatter('top', 3), pulseFeed('top', 5), lens('bottom', 5)],
};

/** Seconds of game time per "round" of the bot's plan, and how often it gets to act. */
export const ROUND_SEC = 20;
export const ACT_SEC = 10;
const MAX_PER_ACT = 3;

export interface BotRun {
  variant: string;
  /** replayable timed actions (t = game seconds) */
  timeline: TimedAction[];
  /** metrics[i] = latched values by game time i+1 seconds */
  metrics: Metrics[];
}

const zero = (): Metrics => Object.fromEntries(METRICS.map((m) => [m, 0])) as Metrics;

/** A copy of `level` whose goal can never be met, so the bot is never 'cleared' (the sim ignores goals anyway). */
function endless(level: LevelDef): LevelDef {
  return { ...level, goals: [{ type: 'novae', count: 1e9, deadlineSec: 1e9, points: 0, label: 'calibration' }], rewards: undefined, solution: undefined };
}

interface Runner { name: string; g: Game; ctx: Ctx; queue: Item[]; run: BotRun; cur: Metrics }

function startRunner(name: string | null, level: LevelDef, world: BoardSize): Runner {
  const g = createGame(level.id, undefined, { level: endless(level), world });
  g.apply({ type: 'start' });
  const s = g.state();
  const f = new Frame(s.width, s.height, level.swirl ?? 1);
  const queue = name ? VARIANTS[name].filter((it) => level.tools.includes(it.tool)) : [];
  return { name: name ?? 'idle', g, ctx: { s, f }, queue, run: { variant: name ?? 'idle', timeline: [], metrics: [] }, cur: zero() };
}

/** Act (in plan order, stop at the first unaffordable item), then run ACT_SEC seconds sampling every second. */
function playSpan(r: Runner, sec = ACT_SEC): void {
  const s = r.g.state();
  r.ctx.s = s;
  let placed = 0;
  while (r.queue.length && placed < MAX_PER_ACT) {
    const it = r.queue[0];
    if ((it.minRound - 1) * ROUND_SEC > s.time + 1e-9) break;
    if (s.energy < TOOL_DEFS[it.tool].cost) break;
    r.queue.shift();
    const p = it.at(r.ctx);
    if (!p) continue;
    const a = r.ctx.f.toBoard(p.u, p.v);
    const act: Action = { type: 'place', tool: it.tool, x: round2(a.x), y: round2(a.y) };
    if (p.u2 !== undefined && p.v2 !== undefined) {
      const b = r.ctx.f.toBoard(p.u2, p.v2);
      act.x2 = round2(b.x); act.y2 = round2(b.y);
    }
    if (r.g.apply(act).ok) { r.run.timeline.push({ t: s.totalTick / TICKS_PER_SECOND, action: act }); placed++; }
  }
  for (let i = 0; i < sec; i++) {
    r.g.step(TICKS_PER_SECOND);
    sampleMetrics(r.g.state(), r.cur);
    r.run.metrics.push({ ...r.cur });
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Heuristic value of a (partial) run for choosing between variants; weights favour the featured metrics. */
export type Scorer = (m: Metrics) => number;
export const defaultScorer: Scorer = (m) =>
  m.clouds + 2 * m.planets + 6 * m.stars + 8 * m.giants + 8 * m.dwarfs + 20 * m.novae + (m.He + m.CO + m.Fe) / 20;

/**
 * Play `level` for `horizonSec` seconds: each variant for `screenSec`, then only the best one continues.
 * Returns the best run (timeline + per-second metrics).
 */
export function runBot(level: LevelDef, world: BoardSize, opts: { horizonSec: number; variants?: string[]; screenSec?: number; score?: Scorer }): BotRun {
  const names = opts.variants ?? Object.keys(VARIANTS);
  const score = opts.score ?? defaultScorer;
  const horizon = Math.ceil(opts.horizonSec / ACT_SEC) * ACT_SEC;
  const screen = Math.min(horizon, opts.screenSec ?? 30);
  let runners = names.map((n) => startRunner(n, level, world));
  for (let t = 0; t < screen; t += ACT_SEC) for (const x of runners) playSpan(x);
  if (runners.length > 1 && screen < horizon) {
    // early on, the heaviest body (progress toward a star) matters more than the counts so far
    const early = (x: Runner) => score(x.cur) + x.g.state().bodies.reduce((m, b) => Math.max(m, b.mass), 0) / 10;
    runners.sort((a, b) => early(b) - early(a) || names.indexOf(a.name) - names.indexOf(b.name));
    runners = [runners[0]];
  }
  for (const x of runners) while (x.run.metrics.length < horizon) playSpan(x);
  runners.sort((a, b) => score(b.cur) - score(a.cur) || names.indexOf(a.name) - names.indexOf(b.name));
  return runners[0].run;
}

/**
 * Place nothing for up to `horizonSec`, sampling metrics each second. `stop(metrics, sec)` may end the run early.
 */
export function runIdle(level: LevelDef, world: BoardSize, horizonSec: number, stop?: (m: Metrics, sec: number, s: GameState) => boolean): Metrics[] {
  const r = startRunner(null, level, world);
  while (r.run.metrics.length < horizonSec) {
    playSpan(r, 1);
    if (stop?.(r.cur, r.run.metrics.length, r.g.state())) break;
  }
  return r.run.metrics;
}

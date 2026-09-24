/**
 * Procedural levels (n >= 4), deterministic in (n, world).
 * 1. Roll the level's physics from n: rounds, energy, gas current, particles, element mix, tool palette.
 * 2. Calibrate: the heuristic bot (bot.ts) plays it; per-round metrics are recorded.
 * 3. Goals = ~80-90% of what the best bot run achieved, due the round the bot got there (+1 on early levels).
 *    The sim does not depend on goals, so the bot's action line provably meets every goal by its round.
 * 4. Verify place-nothing loses (real run); otherwise tighten, then re-roll the seed.
 */
import { createGame } from '../sim/game.ts';
import { mulberry32, type Rng } from '../sim/rng.ts';
import type { Element, Goal, LevelDef, ToolId } from '../sim/types.ts';
import { metricGoal, runBot, type BoardSize, type BotRun, type Metric, type Metrics, type Scorer } from './bot.ts';

export interface GenReport { level: LevelDef; run: BotRun; attempts: number; ms: number }

const ADJ = ['Ember', 'Hollow', 'Silent', 'Drifting', 'Cinder', 'Pale', 'Veiled', 'Burning', 'Quiet', 'Shattered', 'Amber', 'Frozen', 'Restless', 'Violet', 'Iron', 'Last'];
const NOUN = ['Reach', 'Veil', 'Cradle', 'Tide', 'Crucible', 'Shoal', 'Hearth', 'Maelstrom', 'Expanse', 'Nursery', 'Furnace', 'Eddy', 'Spire', 'Wake', 'Deep', 'Choir'];
const FLAVOUR = [
  'A slow tide of gas turns here.', 'Old light hangs in thin streams.', 'The nursery stirs in its sleep.',
  'Dust remembers the last explosion.', 'A restless current sweeps the dark.', 'Cold gas waits for a push.',
];

function hashKey(n: number, world: BoardSize): number {
  let h = 0x811c9dc5;
  for (const v of [n, world.width * 100, world.height * 100, world.gridW, world.gridH]) {
    h ^= Math.round(v) >>> 0; h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.int(xs.length)];

const LABEL: Record<Metric, (c: number) => string> = {
  clouds: (c) => `Have ${c} cloud${c > 1 ? 's' : ''} (or bigger bodies)`,
  planets: (c) => `Grow ${c} planet${c > 1 ? 's' : ''} (mass 40)`,
  stars: (c) => `Ignite ${c} star${c > 1 ? 's' : ''} (mass 120)`,
  giants: (c) => `Swell ${c} red giant${c > 1 ? 's' : ''}`,
  dwarfs: (c) => `Leave ${c} white dwarf${c > 1 ? 's' : ''}`,
  He: (c) => `Fuse ${c} helium`,
  CO: (c) => `Produce ${c} carbon + oxygen`,
  Fe: (c) => `Forge ${c} iron in a supernova`,
  novae: (c) => `Trigger ${c} supernova${c > 1 ? 'e' : ''}`,
};
const ELEMENT_METRICS: Metric[] = ['He', 'CO', 'Fe'];

/** Featured goal metrics per difficulty tier, then fallbacks (tried in order). */
function goalPlan(n: number): { featured: Metric[]; fallback: Metric[]; want: number } {
  if (n <= 5) return { featured: ['stars', 'He'], fallback: ['planets'], want: 2 };
  if (n <= 7) return { featured: ['CO', 'giants'], fallback: ['stars', 'He', 'planets'], want: 2 };
  return { featured: n % 2 === 0 ? ['novae', 'dwarfs', 'Fe'] : ['novae', 'Fe', 'dwarfs'], fallback: ['CO', 'giants', 'stars', 'He'], want: n >= 10 ? 3 : 2 };
}

/** Tools in the palette and the reward on win for level n. */
function toolsFor(n: number): { tools: ToolId[]; rewards?: Partial<Record<ToolId, number>> } {
  const tools: ToolId[] = ['repulsor', 'wall', 'lens', 'pulse'];
  if (n >= 8) tools.push('red_matter');
  if (n >= 11) tools.push('black_hole');
  const rewards: Partial<Record<ToolId, number>> | undefined =
    n % 3 === 2 ? { black_hole: 1 } : n % 3 === 1 && n >= 7 ? { red_matter: 1 } : undefined;
  return { tools, rewards };
}

/** Physics of level n (goals are filled in by calibration). */
function rollLevel(n: number, world: BoardSize, rng: Rng, attempt: number): LevelDef {
  const k = n - 4;
  const rounds = Math.min(7, 4 + Math.floor(k / 2));
  const swirlMag = Math.min(1.5, 1 + 0.07 * k) * (0.92 + 0.16 * rng.next());
  const flip = n >= 6 && rng.next() < 0.45;
  const he = n <= 5 ? 0 : n <= 7 ? 0.2 : Math.min(0.45, 0.3 + 0.03 * (n - 8));
  const mix: Partial<Record<Element, number>> = he > 0 ? { H: 1 - he, He: he } : { H: 1 };
  const { tools, rewards } = toolsFor(n);
  const adj = pick(rng, ADJ), noun = pick(rng, NOUN);
  const intro = [pick(rng, FLAVOUR), flip ? 'Here the current runs clockwise.' : '', he > 0 ? 'The gas is old and helium-rich: stars here swell into giants sooner.' : '']
    .filter(Boolean).join(' ');
  return {
    id: n, name: `${adj} ${noun}`, intro,
    seed: (hashKey(n, world) ^ Math.imul(attempt + 1, 0x9e3779b1)) >>> 0,
    particleCount: Math.min(3400, 2700 + 80 * k),
    initialMix: mix,
    rounds, ticksPerRound: 600,
    startingEnergy: Math.max(75, 105 - 4 * k), incomePerRound: Math.max(35, 55 - 2 * k),
    ambientGravity: Math.round((0.26 + 0.08 * rng.next()) * 100) / 100,
    swirl: Math.round((flip ? -swirlMag : swirlMag) * 100) / 100,
    tools, goals: [], ...(rewards ? { rewards } : {}),
  };
}

function scorerFor(n: number): Scorer {
  const { featured } = goalPlan(n);
  return (m: Metrics) => {
    let v = m.clouds + 2 * m.planets + 5 * m.stars;
    for (const f of featured) v += ELEMENT_METRICS.includes(f) ? m[f] / 10 : 25 * m[f];
    return v;
  };
}

const firstRound = (run: BotRun, m: Metric, count: number): number => {
  const i = run.metrics.findIndex((x) => x[m] >= count);
  return i < 0 ? -1 : i + 1;
};

/** Goals from the bot's run: `frac` of its best, due when it got there (+slack rounds). */
function deriveGoals(n: number, run: BotRun, frac: number, slack: number, rounds: number): Goal[] | null {
  const last = run.metrics[run.metrics.length - 1];
  const { featured, fallback, want } = goalPlan(n);
  const ok = (m: Metric) => (ELEMENT_METRICS.includes(m) ? last[m] >= 20 : last[m] >= 1);
  const chosen: Metric[] = [];
  for (const m of [...featured, ...fallback]) if (chosen.length < want && ok(m)) chosen.push(m);
  if (chosen.length === 0) return null;
  const goal = (m: Metric, value: number): Goal | null => {
    let count = ELEMENT_METRICS.includes(m) ? Math.max(5, Math.floor((value * frac) / 5) * 5) : Math.max(1, Math.floor(value * frac));
    count = Math.min(count, value);
    const r = firstRound(run, m, count);
    if (r < 0) return null;
    const byRound = Math.min(rounds, r + slack);
    return { ...metricGoal(m), count, byRound, label: LABEL[m](count) } as Goal;
  };
  const goals: Goal[] = [];
  // an early structural goal (clouds by round 1-2) keeps the level honest from the start
  const early = run.metrics[Math.min(1, run.metrics.length - 1)];
  if (early.clouds >= 1) { const g = goal('clouds', early.clouds); if (g) goals.push(g); }
  for (const m of chosen) { const g = goal(m, last[m]); if (g) goals.push(g); }
  goals.sort((a, b) => a.byRound - b.byRound);
  return goals;
}

/** Does placing nothing lose? (real run; stops at the first failed goal) */
export function idleLoses(level: LevelDef, world: BoardSize): boolean {
  const g = createGame(level.id, undefined, { level, world });
  for (let r = 0; r < level.rounds + 1 && g.state().phase !== 'won' && g.state().phase !== 'lost'; r++) {
    g.apply({ type: 'endRound' });
    if (g.state().phase === 'plan') g.apply({ type: 'endRound' });
    g.runRound();
  }
  return g.state().phase === 'lost';
}

export function generateLevelReport(n: number, world: BoardSize): GenReport {
  if (n < 4) throw new Error(`procedural levels start at 4 (got ${n})`);
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const board: BoardSize = { width: world.width, height: world.height, gridW: world.gridW, gridH: world.gridH };
  let fallback: GenReport | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const rng = mulberry32(hashKey(n, board) + attempt * 7919);
    const base = rollLevel(n, board, rng, attempt);
    const run = runBot(base, board, { score: scorerFor(n) });
    const frac = Math.min(0.9, 0.8 + 0.02 * (n - 4));
    const slack = n <= 5 ? 1 : 0;
    for (const f of [frac, 1]) {
      const goals = deriveGoals(n, run, f, f === 1 ? 0 : slack, base.rounds);
      if (!goals || goals.length < 2) break;
      const rounds = Math.max(...goals.map((g) => g.byRound));
      const ends = run.actions.reduce((acc, a, i) => (a.type === 'endRound' ? [...acc, i] : acc), [] as number[]);
      const solution = run.actions.slice(0, ends[rounds - 1] + 1);
      const level: LevelDef = { ...base, rounds, goals, solution };
      const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      const rep = { level, run, attempts: attempt + 1, ms };
      if (idleLoses(level, board)) { rep.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0; return rep; }
      fallback ??= rep;
    }
  }
  if (fallback) return fallback;
  throw new Error(`could not calibrate level ${n}`);
}

/** A calibrated, always-winnable level n >= 4 for this board size. Deterministic; takes a few seconds. */
export function generateLevel(n: number, world: BoardSize): LevelDef {
  return generateLevelReport(n, world).level;
}

/**
 * Procedural levels (n >= 4), deterministic in (n, world).
 * 1. Roll the level's physics from n: play length, energy + income/s, gas current, particles, element mix, tool palette.
 * 2. Calibrate: the heuristic bot (bot.ts) plays it on a timeline (acting every ACT_SEC); per-second metrics are recorded.
 * 3. Goals = ~80-90% of what the best bot run achieved; each deadline = when the bot got there + slack.
 *    The sim does not depend on goals, so the bot's timeline provably meets every goal before its deadline.
 * 4. Verify place-nothing misses every goal (real run); otherwise tighten, then re-roll the seed.
 */
import { mulberry32, type Rng } from '../sim/rng.ts';
import type { Element, Goal, LevelDef, ToolId } from '../sim/types.ts';
import { metricGoal, runBot, runIdle, ROUND_SEC, type BoardSize, type BotRun, type Metric, type Metrics, type Scorer } from './bot.ts';

export interface GenReport { level: LevelDef; run: BotRun; attempts: number; ms: number; idleChecked: number }

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

/** Seconds the calibration bot plays level n (goal deadlines fall inside this). */
export function horizonFor(n: number): number {
  return Math.min(110, 80 + 10 * Math.floor((n - 4) / 2));
}

/** Physics of level n (goals are filled in by calibration). */
function rollLevel(n: number, world: BoardSize, rng: Rng, attempt: number): LevelDef {
  const k = n - 4;
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
    startingEnergy: Math.max(75, 105 - 4 * k), incomePerSec: Math.max(35, 55 - 2 * k) / ROUND_SEC,
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

/** First second (1-based) at which the run's metric reached `count`, or -1. */
const firstSec = (metrics: Metrics[], m: Metric, count: number): number => {
  const i = metrics.findIndex((x) => x[m] >= count);
  return i < 0 ? -1 : i + 1;
};

const BASE_POINTS: Record<Metric, number> = { clouds: 100, planets: 150, stars: 250, giants: 300, dwarfs: 350, He: 250, CO: 350, Fe: 400, novae: 500 };

/** Goals from the bot's run: `frac` of its best; deadline = when it got there x (1 + slack) + pad, rounded up to 5 s. */
function deriveGoals(n: number, run: BotRun, frac: number, slack: number, pad: number): Goal[] | null {
  const last = run.metrics[run.metrics.length - 1];
  const { featured, fallback, want } = goalPlan(n);
  const ok = (m: Metric) => (ELEMENT_METRICS.includes(m) ? last[m] >= 20 : last[m] >= 1);
  const chosen: Metric[] = [];
  for (const m of [...featured, ...fallback]) if (chosen.length < want && ok(m)) chosen.push(m);
  if (chosen.length === 0) return null;
  const ptsMul = 1 + 0.1 * (n - 4);
  const goal = (m: Metric, value: number): Goal | null => {
    let count = ELEMENT_METRICS.includes(m) ? Math.max(5, Math.floor((value * frac) / 5) * 5) : Math.max(1, Math.floor(value * frac));
    count = Math.min(count, value);
    const t = firstSec(run.metrics, m, count);
    if (t < 0) return null;
    const deadlineSec = Math.ceil((t * (1 + slack) + pad) / 5) * 5;
    return { ...metricGoal(m), count, deadlineSec, points: Math.round((BASE_POINTS[m] * ptsMul) / 10) * 10, label: LABEL[m](count) } as Goal;
  };
  const goals: Goal[] = [];
  // an early structural goal (clouds within ~30 s) keeps the level honest from the start
  const early = run.metrics[Math.min(29, run.metrics.length - 1)];
  if (early.clouds >= 1) { const g = goal('clouds', early.clouds); if (g) goals.push(g); }
  for (const m of chosen) { const g = goal(m, last[m]); if (g) goals.push(g); }
  goals.sort((a, b) => a.deadlineSec - b.deadlineSec);
  return goals;
}

/**
 * Does placing nothing miss every goal? Checked on a real idle run up to the last deadline, except that
 * the run stops once idle has formed no body at all by IDLE_EMPTY_SEC while every goal due by then is
 * already missed: an empty board that late cannot reach any later goal before its deadline in practice.
 */
const IDLE_EMPTY_SEC = 45;
function idleMissesAll(level: LevelDef, world: BoardSize, idle: { metrics: Metrics[]; emptyAt: number | null }): boolean {
  const last = Math.max(...level.goals.map((g) => g.deadlineSec));
  const need = idle.emptyAt !== null ? Math.min(last, idle.emptyAt) : last;
  if (idle.metrics.length < need) {
    const m = runIdle(level, world, last, (_m, sec, s) => {
      if (sec >= IDLE_EMPTY_SEC && s.bodies.length === 0 && idle.emptyAt === null) { idle.emptyAt = sec; return true; }
      return false;
    });
    idle.metrics = m;
  }
  const METRIC_OF = (g: Goal): Metric => {
    for (const m of Object.keys(BASE_POINTS) as Metric[]) if (JSON.stringify(metricGoal(m)) === JSON.stringify({ type: g.type, ...(g.kind ? { kind: g.kind } : {}), ...(g.el ? { el: g.el } : {}), ...(g.els ? { els: g.els } : {}) })) return m;
    throw new Error(`no metric for goal ${g.label}`);
  };
  return level.goals.every((g) => {
    const t = firstSec(idle.metrics, METRIC_OF(g), g.count);
    return t < 0 || t > g.deadlineSec;
  });
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function generateLevelReport(n: number, world: BoardSize): GenReport {
  if (n < 4) throw new Error(`procedural levels start at 4 (got ${n})`);
  const t0 = now();
  const board: BoardSize = { width: world.width, height: world.height, gridW: world.gridW, gridH: world.gridH };
  let fallback: GenReport | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const rng = mulberry32(hashKey(n, board) + attempt * 7919);
    const base = rollLevel(n, board, rng, attempt);
    const run = runBot(base, board, { horizonSec: horizonFor(n), score: scorerFor(n) });
    const frac = Math.min(0.9, 0.8 + 0.02 * (n - 4));
    const slack = n <= 5 ? 0.3 : n <= 8 ? 0.2 : 0.15;
    const pad = n <= 5 ? 10 : 5;
    const idle = { metrics: [] as Metrics[], emptyAt: null as number | null };
    for (const f of [frac, 1]) {
      const goals = deriveGoals(n, run, f, f === 1 ? slack / 2 : slack, pad);
      if (!goals || goals.length < 2) break;
      const lastDeadline = Math.max(...goals.map((g) => g.deadlineSec));
      const solution = run.timeline.filter((a) => a.t < lastDeadline);
      const level: LevelDef = { ...base, goals, solution };
      const rep: GenReport = { level, run, attempts: attempt + 1, ms: 0, idleChecked: 0 };
      const ok = idleMissesAll(level, board, idle);
      rep.idleChecked = idle.metrics.length;
      rep.ms = now() - t0;
      if (ok) return rep;
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

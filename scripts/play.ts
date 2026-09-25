/**
 * Headless CLI (continuous play).
 *   npm run play -- --level N [--seed S] [--aspect A] [--auto] [--solution] [--ascii]
 * Levels 1-3 are handcrafted; N >= 4 is generated for the board (a few seconds, see src/levels/procgen.ts).
 * --solution replays the level's reference timeline (procedural: level.solution; 1-3: tests/solutions.ts).
 * --auto plays with the calibration bot's heuristics (acting every few seconds) until cleared or every deadline passed.
 * --aspect A (board width/height, e.g. 0.6 for a phone in portrait) sizes the board like the UI does; default 160x90.
 * REPL mode: one JSON per stdin line: an Action ({"type":"place",...}, {"type":"hint"}, ...),
 *   {"type":"advance","seconds":N} (run the clock), {"type":"state"[,"full":true]}, {"type":"help"}, {"type":"ascii"}.
 * The clock starts on the first action (the intro card is dismissed). Prints one compact JSON line per input.
 */
import { createGame, helpText, hintCostOf, playTimeline } from '../src/sim/game.ts';
import { getLevelDef, HANDCRAFTED_COUNT } from '../src/levels/catalog.ts';
import { DEFAULT_WORLD, worldSizeForAspect } from '../src/sim/worldSize.ts';
import { canCondenseAt } from '../src/sim/bodies.ts';
import { runBot } from '../src/levels/bot.ts';
import type { Action, BodyKind, Game, GameState, TimedAction, ToolId } from '../src/sim/types.ts';
import { TOOL_DEFS } from '../src/sim/tools.ts';
import * as readline from 'node:readline';

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (k: string): boolean => argv.includes(k);
const levelId = Number(arg('--level') ?? 1);
const seedArg = arg('--seed');
const seed = seedArg !== undefined ? Number(seedArg) : undefined;
const ascii = flag('--ascii');
const aspectArg = arg('--aspect');
const world = aspectArg !== undefined ? worldSizeForAspect(Number(aspectArg)) : DEFAULT_WORLD;
const makeGame = (): Game => createGame(levelId, seed, {
  world, ...(levelId > HANDCRAFTED_COUNT ? { level: getLevelDef(levelId, world) } : {}),
});

const r1 = (v: number) => Math.round(v * 10) / 10;

function density(s: GameState): Float32Array {
  return s.density ?? new Float32Array(s.gridW * s.gridH);
}

function topCells(s: GameState, n: number): { x: number; y: number; d: number }[] {
  const d = density(s);
  const cell = s.width / s.gridW;
  const idx = Array.from(d.keys()).sort((a, b) => d[b] - d[a] || a - b);
  const out: { x: number; y: number; d: number }[] = [];
  for (const k of idx) {
    const x = ((k % s.gridW) + 0.5) * cell, y = (Math.floor(k / s.gridW) + 0.5) * cell;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 8)) continue;
    out.push({ x: r1(x), y: r1(y), d: Math.round(d[k] * 100) / 100 });
    if (out.length >= n) break;
  }
  return out;
}

function goalsSummary(s: GameState) {
  return s.goals.map((x) => ({
    label: x.goal.label, current: x.current, need: x.goal.count, remainingSec: r1(x.remainingSec), deadlineSec: x.goal.deadlineSec,
    met: x.met, ...(x.metAt !== undefined ? { metAt: r1(x.metAt) } : {}), missed: x.missed, points: x.goal.points,
  }));
}

function summary(g: Game, full = false): Record<string, unknown> {
  const s = g.state();
  const bodies: Partial<Record<BodyKind, unknown[]>> = {};
  for (const b of s.bodies) {
    (bodies[b.kind] ??= []).push({ id: b.id, x: r1(b.x), y: r1(b.y), mass: Math.round(b.mass), progress: r1(b.progress) });
  }
  const els: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.scoreboard.elements)) if (v > 0) els[k] = Math.floor(v);
  const out: Record<string, unknown> = {
    level: s.levelId, name: s.level.name, phase: s.phase, time: r1(s.time), stars: s.stars,
    energy: Math.floor(s.energy), incomePerSec: s.level.incomePerSec, inventory: s.inventory,
    tools: s.level.tools.map((t: ToolId) => `${t}:${TOOL_DEFS[t].cost}`),
    goals: goalsSummary(s),
    points: s.scoreboard.points, pointsBy: s.scoreboard.pointsBy, nextHintCost: hintCostOf(g),
    hint: s.hint,
    bodies,
    nodes: s.nodes.map((n) => ({
      id: n.id, tool: n.tool, x: r1(n.x), y: r1(n.y), ...(n.x2 !== undefined ? { x2: r1(n.x2), y2: r1(n.y2 ?? 0) } : {}),
      placedAt: r1(n.placedAt), ...(n.expiresAt !== null ? { expiresAt: r1(n.expiresAt) } : {}),
    })),
    freeParticles: s.particles.filter((p) => p.bodyId === 0).length,
    cloudThreshold: Math.round((s.cloudThreshold ?? 0) * 100) / 100,
    densest: topCells(s, 5),
    scoreboard: { clouds: s.scoreboard.cloudsFormed, novae: s.scoreboard.novae, elements: els },
    log: s.log.slice(-6),
  };
  if (full) out.particles = s.particles.map((p) => [r1(p.x), r1(p.y), p.el, p.bodyId]);
  return out;
}

const DCH = ' .:-=+*#%@';
export function asciiMap(s: GameState): string {
  const gw = s.gridW, gh = s.gridH, cell = s.width / gw;
  const d = density(s);
  const thr = s.cloudThreshold ?? 1;
  const rows: string[][] = [];
  for (let j = 0; j < gh; j++) {
    const row: string[] = [];
    for (let i = 0; i < gw; i++) {
      const v = d[j * gw + i];
      let c = Math.min(DCH.length - 1, Math.floor((v / thr) * (DCH.length - 1)));
      if (c === DCH.length - 1 && !canCondenseAt(s, (i + 0.5) * cell, (j + 0.5) * cell)) c--;
      row.push(DCH[c]);
    }
    rows.push(row);
  }
  const put = (x: number, y: number, c: string) => {
    const i = Math.floor(x / cell), j = Math.floor(y / cell);
    if (i >= 0 && j >= 0 && i < gw && j < gh) rows[j][i] = c;
  };
  for (const n of s.nodes) {
    if (n.tool === 'wall' && n.x2 !== undefined && n.y2 !== undefined) {
      const L = Math.hypot(n.x2 - n.x, n.y2 - n.y), steps = Math.max(1, Math.ceil(L / (cell * 0.5)));
      for (let k = 0; k <= steps; k++) put(n.x + ((n.x2 - n.x) * k) / steps, n.y + ((n.y2 - n.y) * k) / steps, '|');
    } else put(n.x, n.y, ({ repulsor: 'R', lens: 'L', pulse: 'P', black_hole: 'X', red_matter: 'M', wall: '|' } as Record<ToolId, string>)[n.tool]);
  }
  if (s.hint) put(s.hint.x, s.hint.y, '?');
  const bc: Record<BodyKind, string> = { cloud: 'c', planet: 'p', star_ms: 'S', star_giant: 'G', white_dwarf: 'W', neutron: 'N', black_hole: 'B' };
  for (const b of s.bodies) put(b.x, b.y, bc[b.kind]);
  const border = '+' + '-'.repeat(gw) + '+';
  return [border, ...rows.map((r) => '|' + r.join('') + '|'), border,
    `t=${s.time.toFixed(1)}s ${s.phase} density: ' '..'%' = 0..${DCH.length - 2}/${DCH.length - 1} of cloud threshold ${thr.toFixed(2)}, '@' = a cloud can condense here ('%' = dense but blocked by a body/lens) | R repulsor | wall L lens P pulse X blackhole M redmatter ? hint | c cloud p planet S star G giant W dwarf N neutron B hole`].join('\n');
}

const lastDeadline = (s: GameState) => Math.max(0, ...s.level.goals.map((g) => g.deadlineSec));

/** Handcrafted reference timelines live in tests/solutions.ts (loaded lazily so the CLI works without tests). */
async function referenceTimeline(s: GameState): Promise<TimedAction[]> {
  if (s.level.solution) return s.level.solution;
  const { SOLUTIONS } = await import('../tests/solutions.ts');
  return SOLUTIONS.find((x) => x.level === levelId)?.timeline ?? [];
}

function result(g: Game): Record<string, unknown> {
  const s = g.state();
  return { result: s.phase, level: levelId, time: r1(s.time), stars: s.stars, points: s.scoreboard.points, pointsBy: s.scoreboard.pointsBy, goals: goalsSummary(s), log: s.log.slice(-4) };
}

async function main(): Promise<void> {
  const g = makeGame();
  if (flag('--solution') || flag('--auto')) {
    let timeline: TimedAction[];
    if (flag('--solution')) timeline = await referenceTimeline(g.state());
    else {
      // the calibration bot plays a copy of the level; its timeline is replayed on the real game
      const s = g.state();
      timeline = runBot(s.level, { width: s.width, height: s.height, gridW: s.gridW, gridH: s.gridH }, { horizonSec: lastDeadline(s) }).timeline;
    }
    playTimeline(g, timeline, { untilSec: lastDeadline(g.state()), stopWhenCleared: true });
    if (ascii) process.stderr.write(asciiMap(g.state()) + '\n');
    process.stdout.write(JSON.stringify({ ...result(g), timeline }) + '\n');
    process.exit(g.state().phase === 'cleared' ? 0 : 1);
  }
  g.apply({ type: 'start' });
  process.stdout.write(JSON.stringify({ help: helpText(g.state()), state: summary(g) }) + '\n');
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const t = line.trim();
    if (!t) return;
    let msg: { type: string; full?: boolean; seconds?: number };
    try { msg = JSON.parse(t); } catch { process.stdout.write(JSON.stringify({ ok: false, reason: 'bad JSON' }) + '\n'); return; }
    if (msg.type === 'help') { process.stdout.write(JSON.stringify({ help: g.help() }) + '\n'); return; }
    if (msg.type === 'state') { process.stdout.write(JSON.stringify(summary(g, !!msg.full)) + '\n'); return; }
    if (msg.type === 'ascii') { process.stdout.write(JSON.stringify({ ascii: asciiMap(g.state()) }) + '\n'); return; }
    if (msg.type === 'advance') {
      const sec = Number(msg.seconds ?? 1);
      if (!Number.isFinite(sec) || sec < 0 || sec > 600) { process.stdout.write(JSON.stringify({ ok: false, reason: 'seconds must be 0..600' }) + '\n'); return; }
      g.runFor(sec);
      if (ascii) process.stderr.write(asciiMap(g.state()) + '\n');
      process.stdout.write(JSON.stringify({ ok: true, state: summary(g) }) + '\n');
      return;
    }
    const r = g.apply(msg as Action);
    if (r.ok && msg.type === 'restart') g.apply({ type: 'start' });
    process.stdout.write(JSON.stringify({ ...r, state: summary(g) }) + '\n');
  });
}

if (process.argv[1]?.endsWith('play.ts')) void main();

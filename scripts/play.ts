/**
 * Headless CLI.
 *   npm run play -- --level N [--seed S] [--auto] [--ascii]
 * REPL mode: one JSON per stdin line: an Action, {"type":"state"[,"full":true]}, {"type":"help"}, {"type":"ascii"}.
 * Prints one compact JSON line per input. Intro/round-end cards are auto-dismissed, so you are always in
 * plan phase until the level is won/lost; {"type":"endRound"} runs the whole round.
 */
import { createGame, helpText } from '../src/sim/game.ts';
import { canCondenseAt } from '../src/sim/bodies.ts';
import type { Action, BodyKind, Game, GameState, ToolId } from '../src/sim/types.ts';
import { TOOL_DEFS } from '../src/sim/tools.ts';
import * as readline from 'node:readline';

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (k: string): boolean => argv.includes(k);
const levelId = Number(arg('--level') ?? 1);
const seedArg = arg('--seed');
const seed = seedArg !== undefined ? Number(seedArg) : undefined;
const ascii = flag('--ascii');

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Smoothed free-gas density per cell, as the sim sees it. */
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

function summary(g: Game, full = false): Record<string, unknown> {
  const s = g.state();
  const bodies: Partial<Record<BodyKind, unknown[]>> = {};
  for (const b of s.bodies) {
    (bodies[b.kind] ??= []).push({ id: b.id, x: r1(b.x), y: r1(b.y), mass: Math.round(b.mass), progress: r1(b.progress) });
  }
  const els: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.scoreboard.elements)) if (v > 0) els[k] = Math.floor(v);
  const out: Record<string, unknown> = {
    level: s.levelId, name: s.level.name, phase: s.phase, round: s.round, rounds: s.level.rounds, tick: s.tick,
    energy: s.energy, inventory: s.inventory,
    tools: s.level.tools.map((t: ToolId) => `${t}:${TOOL_DEFS[t].cost}`),
    goals: s.goals.map((x) => ({ label: x.goal.label, byRound: x.goal.byRound, current: x.current, need: x.goal.count, met: x.met })),
    bodies,
    nodes: s.nodes.map((n) => ({ id: n.id, tool: n.tool, x: r1(n.x), y: r1(n.y), ...(n.x2 !== undefined ? { x2: r1(n.x2), y2: r1(n.y2 ?? 0) } : {}), ...(n.roundsLeft !== null ? { roundsLeft: n.roundsLeft } : {}) })),
    freeParticles: s.particles.filter((p) => p.bodyId === 0).length,
    cloudThreshold: Math.round((s.cloudThreshold ?? 0) * 100) / 100,
    densest: topCells(s, 5),
    scoreboard: { clouds: s.scoreboard.cloudsFormed, novae: s.scoreboard.novae, elements: els, score: s.scoreboard.score },
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
      // '@' only where a cloud can actually condense (dense enough, not next to a body, not inside a lens)
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
  const bc: Record<BodyKind, string> = { cloud: 'c', planet: 'p', star_ms: 'S', star_giant: 'G', white_dwarf: 'W', neutron: 'N', black_hole: 'B' };
  for (const b of s.bodies) put(b.x, b.y, bc[b.kind]);
  const border = '+' + '-'.repeat(gw) + '+';
  return [border, ...rows.map((r) => '|' + r.join('') + '|'), border,
    `R${s.round} ${s.phase} density: ' '..'%' = 0..${DCH.length - 2}/${DCH.length - 1} of cloud threshold ${thr.toFixed(2)}, '@' = a cloud can condense here ('%' = dense but blocked by a body/lens) | R repulsor | wall L lens P pulse X blackhole M redmatter | c cloud p planet S star G giant W dwarf N neutron B hole`].join('\n');
}

/** Dismiss intro/roundEnd cards so the player is in plan phase. */
function dismiss(g: Game): void {
  const ph = g.state().phase;
  if (ph === 'intro' || ph === 'roundEnd') g.apply({ type: 'start' });
}

function runAction(g: Game, a: Action): { ok: boolean; reason?: string } {
  dismiss(g);
  const r = g.apply(a);
  if (r.ok && a.type === 'endRound') {
    g.runRound();
    if (ascii) process.stderr.write(asciiMap(g.state()) + '\n');
    dismiss(g);
  }
  if (r.ok && a.type === 'restart') dismiss(g);
  return r;
}

// ---------------- auto bot ----------------
function autoPlay(g: Game): boolean {
  const s = g.state();
  dismiss(g);
  const R = TOOL_DEFS.repulsor.radius;
  let turn = 0;
  while (s.phase === 'plan') {
    // target: biggest body, else densest cell
    let tx: number, ty: number;
    const big = [...s.bodies].sort((a, b) => b.mass - a.mass)[0];
    if (big) { tx = big.x; ty = big.y; } else { const t = topCells(s, 1)[0]; tx = t.x; ty = t.y; }
    tx = Math.min(s.width - 25, Math.max(25, tx));
    ty = Math.min(s.height - 20, Math.max(20, ty));
    const cost = TOOL_DEFS.repulsor.cost;
    let k = 0;
    while (s.energy >= cost && k < 6) {
      const ang = (turn * 0.5 + k * (2 * Math.PI / 3)) + (k >= 3 ? Math.PI / 3 : 0);
      const dist = R * 1.25;
      const x = Math.min(s.width - 1, Math.max(1, tx + Math.cos(ang) * dist));
      const y = Math.min(s.height - 1, Math.max(1, ty + Math.sin(ang) * dist));
      const clash = s.nodes.some((n) => Math.hypot(n.x - x, n.y - y) < R * 0.6);
      if (!clash) { const r = g.apply({ type: 'place', tool: 'repulsor', x, y }); if (!r.ok) break; }
      k++;
    }
    turn++;
    runAction(g, { type: 'endRound' });
    process.stdout.write(JSON.stringify({ round: s.phase === 'plan' ? s.round - 1 : s.round, phase: s.phase, goals: summary(g).goals, bodies: summary(g).bodies }) + '\n');
  }
  return s.phase === 'won';
}

function main(): void {
  const g = createGame(levelId, seed);
  if (flag('--auto')) {
    const won = autoPlay(g);
    const s = g.state();
    process.stdout.write(JSON.stringify({ result: s.phase, level: levelId, round: s.round, energy: s.energy, score: s.scoreboard.score, log: s.log.slice(-4) }) + '\n');
    process.exit(won ? 0 : 1);
  }
  dismiss(g);
  process.stdout.write(JSON.stringify({ help: helpText(g.state()), state: summary(g) }) + '\n');
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const t = line.trim();
    if (!t) return;
    let msg: { type: string; full?: boolean };
    try { msg = JSON.parse(t); } catch { process.stdout.write(JSON.stringify({ ok: false, reason: 'bad JSON' }) + '\n'); return; }
    if (msg.type === 'help') { process.stdout.write(JSON.stringify({ help: g.help() }) + '\n'); return; }
    if (msg.type === 'state') { process.stdout.write(JSON.stringify(summary(g, !!msg.full)) + '\n'); return; }
    if (msg.type === 'ascii') { process.stdout.write(JSON.stringify({ ascii: asciiMap(g.state()) }) + '\n'); return; }
    const r = runAction(g, msg as Action);
    process.stdout.write(JSON.stringify({ ...r, state: summary(g) }) + '\n');
  });
}

if (process.argv[1]?.endsWith("play.ts")) main();

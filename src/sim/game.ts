import type { Action, ActionResult, Body, BodyKind, Element, Game, GameFactory, GameOptions, GameState, Node, Scoreboard, ToolId } from './types.ts';
import { ELEMENTS } from './types.ts';
import { DEFAULT_WORLD } from './worldSize.ts';
import { mulberry32 } from './rng.ts';
import { P } from './params.ts';
import { TOOL_DEFS, WALL_MAX_LEN } from './tools.ts';
import { makeWorld, type World } from './world.ts';
import { computeField, initAmbient } from './field.ts';
import { buildCellLists, initParticles, stepCapturedParticles, stepFreeParticles } from './particles.ts';
import { accrete, emptyComposition, formClouds, lifecycle, log, mergeBodies, moveBodies, nodeEffects, radiusFor } from './bodies.ts';
import { getLevel } from '../levels/levels.ts';
import { evaluateGoals, judge } from '../levels/goals.ts';

export type { GameOptions } from './types.ts';

function emptyScoreboard(): Scoreboard {
  const kinds: BodyKind[] = ['cloud', 'planet', 'star_ms', 'star_giant', 'white_dwarf', 'neutron', 'black_hole'];
  const starsByKind = {} as Record<BodyKind, number>;
  for (const k of kinds) starsByKind[k] = 0;
  const elements = {} as Scoreboard['elements'];
  for (const e of ELEMENTS) elements[e] = 0;
  return { cloudsFormed: 0, starsByKind, novae: 0, elements, score: 0 };
}

function newWorld(levelId: number, seed: number | undefined, opts: GameOptions): World {
  const level = opts.level ?? getLevel(levelId);
  const sd = (seed ?? level.seed) >>> 0;
  const rng = mulberry32(sd);
  const ws = opts.world ?? DEFAULT_WORLD;
  const W = ws.width, H = ws.height, gw = Math.max(4, Math.round(ws.gridW)), gh = Math.max(4, Math.round(ws.gridH));
  const s: GameState = {
    levelId, level, seed: sd, phase: 'intro', round: 1, tick: 0, totalTick: 0,
    energy: level.startingEnergy,
    inventory: { ...(opts.inventory ?? {}) },
    particles: initParticles(level, rng, W, H),
    bodies: [], nodes: [],
    field: new Float32Array(gw * gh),
    gridW: gw, gridH: gh, width: W, height: H,
    scoreboard: emptyScoreboard(),
    goals: level.goals.map((goal) => ({ goal, current: 0, met: false })),
    events: [],
    log: [level.intro],
  };
  const w = makeWorld(s, rng);
  s.density = w.rhoF;
  s.cloudThreshold = P.cloudDensity * w.meanDensity;
  initAmbient(w);
  computeField(w);
  evaluateGoals(s, w.maxDensity);
  return w;
}

function updateScore(s: GameState): void {
  const sb = s.scoreboard;
  let stars = 0;
  for (const k of ['star_ms', 'star_giant', 'white_dwarf', 'neutron', 'black_hole'] as BodyKind[]) stars += sb.starsByKind[k];
  let el = 0;
  for (const e of ELEMENTS) el += sb.elements[e];
  sb.score = Math.round(sb.cloudsFormed * P.scoreCloud + stars * P.scoreStar + sb.novae * P.scoreNova + el * P.scorePerElement
    + (sb.energyBonus ?? 0));
}

/** One simulation tick. */
export function tickWorld(w: World): void {
  const s = w.s;
  w.bodyById.clear();
  for (const b of s.bodies) w.bodyById.set(b.id, b);
  computeField(w);
  stepFreeParticles(w);
  moveBodies(w);
  stepCapturedParticles(w);
  buildCellLists(w);
  nodeEffects(w);
  accrete(w);
  if (s.totalTick % P.cloudCheckEvery === 0 && s.totalTick >= P.cloudSettleTicks) formClouds(w);
  mergeBodies(w);
  lifecycle(w);
  if (w.removedParticles > 0) {
    s.particles = s.particles.filter((p) => p.bodyId !== -1);
    w.removedParticles = 0;
  }
  s.tick++;
  s.totalTick++;
  if (s.tick % P.goalEvalEvery === 0) { evaluateGoals(s, w.maxDensity); updateScore(s); }
}

function inBoard(s: GameState, x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= s.width && y <= s.height;
}

export const createGame = ((levelId: number, seed?: number, opts: GameOptions = {}): Game => {
  let w = newWorld(levelId, seed, opts);

  /** Shared placement geometry checks for place/move. Returns an error string or wall endpoint. */
  const checkGeometry = (tool: ToolId, x: number, y: number, ax2: number | undefined, ay2: number | undefined, ignoreId: number): string | { x2?: number; y2?: number } => {
    const s = w.s;
    if (!inBoard(s, x, y)) return 'position outside board';
    let x2: number | undefined, y2: number | undefined;
    if (tool === 'wall') {
      if (ax2 === undefined || ay2 === undefined) return 'wall needs an end point (x2, y2)';
      x2 = ax2; y2 = ay2;
      if (!inBoard(s, x2, y2)) return 'wall endpoint outside board';
      const len = Math.hypot(x2 - x, y2 - y);
      if (len < P.wallMinLen) return `wall too short (${len.toFixed(1)} < ${P.wallMinLen})`;
      if (len > WALL_MAX_LEN) return `wall too long (${len.toFixed(1)} > ${WALL_MAX_LEN})`;
    }
    const ax = tool === 'wall' ? (x + x2!) / 2 : x, ay = tool === 'wall' ? (y + y2!) / 2 : y;
    const clash = s.nodes.find((n) => {
      if (n.tool !== tool || n.id === ignoreId) return false;
      const nx = n.x2 !== undefined ? (n.x + n.x2) / 2 : n.x, ny = n.y2 !== undefined ? (n.y + (n.y2 ?? n.y)) / 2 : n.y;
      return Math.hypot(nx - ax, ny - ay) < P.nodeMinSpacing;
    });
    if (clash) return `too close to ${tool} #${clash.id} (min ${P.nodeMinSpacing} apart)`;
    return { x2, y2 };
  };
  const toPlan = (): void => {
    const s = w.s;
    if (s.phase === 'intro') { s.phase = 'plan'; }
    else if (s.phase === 'roundEnd') {
      s.phase = 'plan';
      s.round++;
      s.tick = 0;
      s.events = [];
    }
  };

  const finishRound = (): void => {
    const s = w.s;
    evaluateGoals(s, w.maxDensity);
    updateScore(s);
    const v = judge(s, s.round);
    // expire timed nodes
    s.nodes = s.nodes.filter((n) => {
      if (n.roundsLeft === null) return true;
      n.roundsLeft--;
      return n.roundsLeft > 0;
    });
    if (v === 'won') {
      s.phase = 'won';
      s.scoreboard.energyBonus = Math.round(s.energy * P.scorePerEnergy);
      updateScore(s);
      const rw = s.level.rewards ?? {};
      for (const k of Object.keys(rw) as ToolId[]) s.inventory[k] = (s.inventory[k] ?? 0) + (rw[k] ?? 0);
      log(w, `LEVEL WON! Score ${s.scoreboard.score} (incl. +${s.scoreboard.energyBonus} for unspent energy)`);
    } else if (v === 'lost') {
      s.phase = 'lost';
      // only goals that were due by now (or all, if this was the last round)
      const due = (g: { goal: { byRound: number } }) => g.goal.byRound <= s.round || s.round >= s.level.rounds;
      const miss = s.goals.filter((g) => !g.met && due(g)).map((g) => `${g.goal.label} (${g.current}/${g.goal.count})`);
      log(w, `Level lost: missed ${miss.join('; ')}`);
    } else {
      s.phase = 'roundEnd';
      s.energy += s.level.incomePerRound;
      log(w, `Round ${s.round} complete: +${s.level.incomePerRound} energy`);
    }
  };

  const game: Game & { world(): World } = {
    world: () => w,
    state: () => w.s,
    apply(a: Action): ActionResult {
      const s = w.s;
      switch (a.type) {
        case 'restart':
          w = newWorld(levelId, seed, opts);
          return { ok: true };
        case 'start':
          if (s.phase !== 'intro' && s.phase !== 'roundEnd') return { ok: false, reason: `cannot start in phase ${s.phase}` };
          toPlan();
          return { ok: true };
        case 'place': {
          if (s.phase === 'intro' || s.phase === 'roundEnd') toPlan();
          if (s.phase !== 'plan') return { ok: false, reason: `can only place in plan phase (phase=${s.phase})` };
          const def = TOOL_DEFS[a.tool];
          if (!def) return { ok: false, reason: `unknown tool ${String(a.tool)}` };
          const inv = s.inventory[a.tool] ?? 0;
          const inPalette = s.level.tools.includes(a.tool);
          if (!inPalette && inv <= 0) return { ok: false, reason: `tool ${a.tool} not available in this level` };
          const geo = checkGeometry(a.tool, a.x, a.y, a.x2, a.y2, -1);
          if (typeof geo === 'string') return { ok: false, reason: geo };
          const { x2, y2 } = geo;
          const free = inv > 0;
          if (!free && s.energy < def.cost) return { ok: false, reason: `not enough energy (${s.energy} < ${def.cost})` };
          if (free) s.inventory[a.tool] = inv - 1; else s.energy -= def.cost;
          const node: Node = {
            id: w.nextNodeId++, tool: a.tool, x: a.x, y: a.y,
            roundsLeft: def.durationRounds, placedRound: s.round,
          };
          if (x2 !== undefined) { node.x2 = x2; node.y2 = y2; }
          if (a.tool === 'black_hole') node.mass = P.blackHoleStartMass;
          if (free) node.free = true;
          s.nodes.push(node);
          computeField(w);
          return { ok: true };
        }
        case 'remove': {
          if (s.phase === 'intro' || s.phase === 'roundEnd') toPlan();
          if (s.phase !== 'plan') return { ok: false, reason: `can only remove in plan phase (phase=${s.phase})` };
          const i = s.nodes.findIndex((n) => n.id === a.nodeId);
          if (i < 0) return { ok: false, reason: `no node ${a.nodeId}` };
          const n = s.nodes[i];
          s.nodes.splice(i, 1);
          if (n.placedRound === s.round) {
            // Placed during this planning phase and never simulated: full refund.
            if (n.free) s.inventory[n.tool] = (s.inventory[n.tool] ?? 0) + 1;
            else s.energy += TOOL_DEFS[n.tool].cost;
          }
          computeField(w);
          return { ok: true };
        }
        case 'move': {
          if (s.phase === 'intro' || s.phase === 'roundEnd') toPlan();
          if (s.phase !== 'plan') return { ok: false, reason: `can only move in plan phase (phase=${s.phase})` };
          const n = s.nodes.find((q) => q.id === a.nodeId);
          if (!n) return { ok: false, reason: `no node ${a.nodeId}` };
          if (n.placedRound !== s.round) return { ok: false, reason: 'only nodes placed this round can be moved' };
          let mx2 = a.x2, my2 = a.y2;
          if (n.tool === 'wall' && (mx2 === undefined || my2 === undefined)) {
            // translate the wall, keeping its shape
            mx2 = a.x + (n.x2! - n.x); my2 = a.y + (n.y2! - n.y);
          }
          const geo = checkGeometry(n.tool, a.x, a.y, mx2, my2, n.id);
          if (typeof geo === 'string') return { ok: false, reason: geo };
          n.x = a.x; n.y = a.y;
          if (n.tool === 'wall') { n.x2 = geo.x2; n.y2 = geo.y2; }
          computeField(w);
          return { ok: true };
        }
        case 'endRound':
          if (s.phase === 'intro' || s.phase === 'roundEnd') { toPlan(); return { ok: true }; }
          if (s.phase !== 'plan') return { ok: false, reason: `can only end round in plan phase (phase=${s.phase})` };
          s.phase = 'running';
          s.tick = 0;
          s.events = [];
          log(w, `Round ${s.round} running`);
          return { ok: true };
        default:
          return { ok: false, reason: 'unknown action' };
      }
    },
    step(n = 1): boolean {
      const s = w.s;
      if (s.phase !== 'running') return false;
      for (let i = 0; i < n && s.phase === 'running'; i++) {
        tickWorld(w);
        if (s.tick >= s.level.ticksPerRound) finishRound();
      }
      return w.s.phase === 'running';
    },
    runRound(): void {
      const s = w.s;
      if (s.phase !== 'running') return;
      game.step(s.level.ticksPerRound - s.tick);
    },
    help(): string {
      return helpText(w.s);
    },
  };
  return game;
}) satisfies GameFactory;

export function helpText(s: GameState): string {
  const L = s.level;
  const lines: string[] = [];
  lines.push(`LEVEL ${L.id} "${L.name}": ${L.intro}`);
  lines.push(`Board ${s.width}x${s.height} (x right, y down). ${L.rounds} rounds x ${L.ticksPerRound} ticks. Energy ${s.energy} now, +${L.incomePerRound}/round.`);
  lines.push('GOALS: ' + L.goals.map((g) => `${g.label} [${g.type} >= ${g.count} by end of round ${g.byRound}]`).join('; '));
  const mean = L.particleCount / (s.gridW * s.gridH);
  lines.push('RULES: Gas circulates counter-clockwise (on screen) around the centre: right side flows up, top flows left, left flows down, bottom flows right. '
    + 'It spreads out under its own pressure. Block or squeeze the current with nodes: gas piles up upstream of obstacles, and where the pile gets dense '
    + `(~${(P.cloudDensity * mean).toFixed(1)} particles per 2.5x2.5 cell, ${P.cloudDensity}x the average) a CLOUD condenses. `
    + 'Bodies drift with the current and swallow nearby gas at a rate set by how dense the gas around them is (so herding gas into a body grows it faster); they merge when they touch. '
    + `Lenses pull bodies together and make bodies inside them feed ${P.lensFeedMul}x faster, but barely move gas and no cloud forms inside a lens. `
    + `New clouds hold at most ${P.cloudMaxBirthMass} mass. `
    + `Mass ${P.planetMass}: planet. Mass ${P.starMass}: star (fuses H->He; heavier burns much faster). H below ${P.giantHFrac * 100}%: red giant (fuses He->C+O). `
    + `Giant out of He: white dwarf, or SUPERNOVA if mass >= ${P.novaMass} (ejects ${P.novaEjectFrac * 100}% as C/O/Fe/heavy gas, leaves a neutron star). `
    + `A white dwarf fed to ${P.wdNovaMass} also explodes. Neutron stars do not feed; merged past ${P.neutronMaxMass} they collapse. Mass >= ${P.collapseMass}: black hole.`);
  if (L.rewards) lines.push('REWARD on win: ' + Object.entries(L.rewards).map(([k, v]) => `${k} x${v}`).join(', ')
    + ' (free uses, added to state.inventory; carry them into another level with createGame(levelId, seed, { inventory }))');
  lines.push('SCORE: clouds x' + P.scoreCloud + ', stars x' + P.scoreStar + ', supernovae x' + P.scoreNova + ', +1 per element produced, +'
    + P.scorePerEnergy + ' per unspent energy when you win.');
  lines.push('LOOP: plan (place/remove nodes, nodes placed this round can be moved for free or removed for a full refund; older nodes can be removed without refund) -> endRound -> sim runs -> goals checked, income paid -> next plan. Miss a goal by its round = lose.');
  const avail = new Set<ToolId>([...L.tools, ...(Object.keys(s.inventory) as ToolId[]).filter((k) => (s.inventory[k] ?? 0) > 0)]);
  lines.push('TOOLS:');
  for (const t of avail) {
    const d = TOOL_DEFS[t];
    const inv = s.inventory[t] ? ` (free x${s.inventory[t]})` : '';
    lines.push(`  ${t}: cost ${d.cost}${inv}, radius ${d.radius}, ${d.durationRounds === null ? 'permanent' : d.durationRounds + ' round'}. ${d.description}`);
  }
  lines.push(`ACTIONS (JSON): {"type":"place","tool":"repulsor","x":${Math.round(s.width / 2)},"y":${Math.round(s.height / 2)}} | wall needs "x2","y2" (length ${P.wallMinLen}-${P.wallMaxLen}) | nodes of one tool must be ${P.nodeMinSpacing}+ apart | {"type":"remove","nodeId":1} | {"type":"move","nodeId":1,"x":${Math.round(s.width / 2 + 10)},"y":${Math.round(s.height / 2 - 5)}} (this round's nodes only; walls keep their shape unless x2,y2 given) | {"type":"endRound"} | {"type":"restart"}`);
  return lines.join('\n');
}

/**
 * Replay helper: apply actions in order. Here `endRound` always means "run the next round":
 * if it only dismissed an intro/roundEnd card it is applied again, then the round is run to completion.
 */
export function applyActions(game: Game, actions: Action[]): ActionResult[] {
  const out: ActionResult[] = [];
  for (const a of actions) {
    let r = game.apply(a);
    if (r.ok && a.type === 'endRound' && game.state().phase === 'plan') r = game.apply(a);
    out.push(r);
    if (r.ok && a.type === 'endRound') game.runRound();
  }
  return out;
}

/** Stable FNV-1a hash of the deterministic parts of the state. */
export function hashState(s: GameState): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    const q = Math.round(v * 1000) | 0;
    h ^= q & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  };
  mix(s.round); mix(s.tick); mix(s.totalTick); mix(s.energy);
  for (const p of s.particles) { mix(p.x); mix(p.y); mix(p.vx); mix(p.vy); mix(p.bodyId); mix(ELEMENTS.indexOf(p.el)); }
  for (const b of s.bodies) { mix(b.id); mix(b.x); mix(b.y); mix(b.mass); for (const e of ELEMENTS) mix(b.composition[e]); }
  for (const n of s.nodes) { mix(n.id); mix(n.x); mix(n.y); }
  for (let i = 0; i < s.field.length; i++) mix(s.field[i]);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Debug/test helper: spawn a body of `kind` with `mass` captured particles at (x,y).
 * composition defaults to all H. Only works on games made by createGame.
 */
export function debugSpawnBody(game: Game, kind: BodyKind, x: number, y: number, mass: number,
  composition?: Partial<Record<Element, number>>): Body {
  const w = (game as Game & { world(): World }).world();
  const s = w.s;
  const comp = emptyComposition();
  const src = composition ?? { H: 1 };
  let tot = 0;
  for (const e of ELEMENTS) tot += src[e] ?? 0;
  for (const e of ELEMENTS) comp[e] = ((src[e] ?? 0) / (tot || 1)) * mass;
  const b: Body = { id: w.nextBodyId++, kind, x, y, vx: 0, vy: 0, mass, radius: radiusFor(kind, mass), composition: comp, age: 0, progress: 0 };
  s.bodies.push(b);
  w.bodyById.set(b.id, b);
  // captured particles, elements allocated in order of composition
  let e = 0, left = comp[ELEMENTS[0]];
  for (let i = 0; i < mass; i++) {
    while (left < 0.5 && e < ELEMENTS.length - 1) { e++; left += comp[ELEMENTS[e]]; }
    left -= 1;
    const a = (i * 2.399963) % (2 * Math.PI), r = b.radius * 0.8 * Math.sqrt((i + 0.5) / mass);
    s.particles.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: 0, vy: 0, el: ELEMENTS[e], bodyId: b.id });
  }
  return b;
}

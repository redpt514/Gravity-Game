import type { Action, ActionResult, Body, BodyKind, Element, Game, GameFactory, GameOptions, GameState, Node, Scoreboard, TimedAction, ToolId } from './types.ts';
import { ELEMENTS, GRACE_SEC, TICKS_PER_SECOND } from './types.ts';
import { DEFAULT_WORLD } from './worldSize.ts';
import { mulberry32 } from './rng.ts';
import { P, POINTS } from './params.ts';
import { TOOL_DEFS, WALL_MAX_LEN } from './tools.ts';
import { makeWorld, type World } from './world.ts';
import { computeField, initAmbient } from './field.ts';
import { buildCellLists, initParticles, stepCapturedParticles, stepFreeParticles } from './particles.ts';
import { accrete, emptyComposition, formClouds, lifecycle, log, mergeBodies, moveBodies, nodeEffects, radiusFor } from './bodies.ts';
import { computeHint } from './hint.ts';
import { getLevel } from '../levels/levels.ts';
import { updateGoals } from '../levels/goals.ts';

export type { GameOptions } from './types.ts';

/** A Game made by createGame also exposes its internal World (tests, hint engine, CLI). */
export type SimGame = Game & { world(): World };

function emptyScoreboard(): Scoreboard {
  const kinds: BodyKind[] = ['cloud', 'planet', 'star_ms', 'star_giant', 'white_dwarf', 'neutron', 'black_hole'];
  const starsByKind = {} as Record<BodyKind, number>;
  for (const k of kinds) starsByKind[k] = 0;
  const elements = {} as Scoreboard['elements'];
  for (const e of ELEMENTS) elements[e] = 0;
  return {
    cloudsFormed: 0, starsByKind, novae: 0, elements, points: POINTS.startPoints,
    pointsBy: { clouds: 0, planets: 0, stars: 0, novae: 0, elements: 0, goals: 0, spentHints: 0 },
  };
}

function newWorld(levelId: number, seed: number | undefined, opts: GameOptions): World {
  const level = opts.level ?? getLevel(levelId);
  const sd = (seed ?? level.seed) >>> 0;
  const rng = mulberry32(sd);
  const ws = opts.world ?? DEFAULT_WORLD;
  const W = ws.width, H = ws.height, gw = Math.max(4, Math.round(ws.gridW)), gh = Math.max(4, Math.round(ws.gridH));
  const s: GameState = {
    levelId, level, seed: sd, phase: 'intro', time: 0, totalTick: 0,
    energy: level.startingEnergy,
    inventory: { ...(opts.inventory ?? {}) },
    particles: initParticles(level, rng, W, H),
    bodies: [], nodes: [],
    field: new Float32Array(gw * gh),
    gridW: gw, gridH: gh, width: W, height: H,
    scoreboard: emptyScoreboard(),
    goals: level.goals.map((goal) => ({ goal, current: 0, met: false, missed: false, remainingSec: goal.deadlineSec })),
    stars: 0,
    hint: null,
    events: [],
    log: [level.intro],
  };
  const w = makeWorld(s, rng);
  s.density = w.rhoF;
  s.cloudThreshold = P.cloudDensity * w.meanDensity;
  initAmbient(w);
  computeField(w);
  updateGoals(s, w.maxDensity);
  return w;
}

/**
 * Deep copy of a world (state, rng position, id counters, accretion budgets). The copy evolves exactly like
 * the original would and shares nothing mutable with it. Used by the hint engine's lookahead.
 */
export function cloneWorld(w: World): World {
  const s = w.s;
  const c: GameState = {
    ...s,
    inventory: { ...s.inventory },
    particles: s.particles.map((p) => ({ ...p })),
    bodies: s.bodies.map((b) => ({ ...b, composition: { ...b.composition } })),
    nodes: s.nodes.map((n) => ({ ...n })),
    field: new Float32Array(s.field),
    scoreboard: {
      ...s.scoreboard, starsByKind: { ...s.scoreboard.starsByKind }, elements: { ...s.scoreboard.elements },
      pointsBy: { ...s.scoreboard.pointsBy },
    },
    goals: s.goals.map((g) => ({ ...g })),
    hint: s.hint ? { ...s.hint } : null,
    events: s.events.map((e) => ({ ...e })),
    log: [...s.log],
  };
  const cw = makeWorld(c, mulberry32(w.rng.getState()));
  cw.nextBodyId = w.nextBodyId;
  cw.nextNodeId = w.nextNodeId;
  cw.meanDensity = w.meanDensity;
  cw.accreteBudget = new Map(w.accreteBudget);
  cw.hintsUsed = w.hintsUsed;
  c.density = cw.rhoF;
  initAmbient(cw);
  computeField(cw);
  return cw;
}

/** Recompute derived points (elements) and the total. Points never go negative. */
function refreshPoints(s: GameState): void {
  const pb = s.scoreboard.pointsBy;
  let el = 0;
  for (const e of ELEMENTS) el += s.scoreboard.elements[e] * POINTS.element[e];
  pb.elements = Math.floor(el);
  s.scoreboard.points = Math.max(0, POINTS.startPoints + pb.clouds + pb.planets + pb.stars + pb.novae + pb.elements + pb.goals - pb.spentHints);
}

/** Goal countdowns, latching, points and the cleared transition (every tick, and once at level start). */
function goalsTick(w: World): void {
  const s = w.s;
  for (const ch of updateGoals(s, w.maxDensity)) {
    const gs = s.goals[ch.index];
    if (ch.kind === 'met') {
      const g = gs.goal;
      const early = g.deadlineSec > 0 ? Math.max(0, g.deadlineSec - s.time) / g.deadlineSec : 0;
      const pts = Math.round(g.points * (1 + POINTS.goalEarlyBonus * early));
      s.scoreboard.pointsBy.goals += pts;
      log(w, `Goal met: ${g.label} (+${pts} points${early > 0 ? `, ${Math.round(gs.remainingSec)}s early` : ''})`);
      if (s.hint && s.hint.goalIndex === ch.index) s.hint = null;
    } else {
      log(w, `Time's up for: ${gs.goal.label} (${gs.current}/${gs.goal.count}); it still counts if you finish it, for fewer stars`);
    }
  }
  if (s.phase === 'playing' && s.goals.every((g) => g.met)) {
    s.phase = 'cleared';
    const missed = s.goals.filter((g) => g.missed).length;
    s.stars = Math.max(1, 3 - missed);
    const rw = s.level.rewards ?? {};
    for (const k of Object.keys(rw) as ToolId[]) s.inventory[k] = (s.inventory[k] ?? 0) + (rw[k] ?? 0);
    refreshPoints(s);
    log(w, `LEVEL CLEARED at ${s.time.toFixed(0)}s: ${s.stars} star${s.stars > 1 ? 's' : ''}, ${s.scoreboard.points} points. The grid keeps running.`);
  }
}

/** One simulation tick: physics, income, timed nodes, goals, points. */
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
  s.totalTick++;
  s.time = s.totalTick / TICKS_PER_SECOND;
  s.energy += s.level.incomePerSec / TICKS_PER_SECOND;
  if (s.nodes.some((n) => n.expiresAt !== null && n.expiresAt <= s.time)) s.nodes = s.nodes.filter((n) => n.expiresAt === null || n.expiresAt > s.time);
  if (s.events.length && s.time - s.events[0].t > P.eventKeepSec) s.events = s.events.filter((e) => s.time - e.t <= P.eventKeepSec);
  goalsTick(w);
  refreshPoints(s);
}

function inBoard(s: GameState, x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= s.width && y <= s.height;
}

/** Points the next hint costs in this game. */
export function nextHintCost(s: GameState, hintsUsed: number): number {
  void s;
  return POINTS.hintCost * (1 + hintsUsed);
}

/** Game interface around a world; `reset` makes the world `restart` goes back to. */
function wrapWorld(w0: World, reset: () => World): SimGame {
  let w = w0;

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

  /** place/remove/move/hint dismiss the intro card. */
  const begin = (): void => {
    if (w.s.phase === 'intro') { w.s.phase = 'playing'; log(w, 'Clock started'); }
  };

  const game: SimGame = {
    world: () => w,
    state: () => w.s,
    apply(a: Action): ActionResult {
      const s = w.s;
      switch (a.type) {
        case 'restart':
          w = reset();
          return { ok: true };
        case 'start':
          if (s.phase !== 'intro') return { ok: false, reason: `already started (phase ${s.phase})` };
          begin();
          return { ok: true };
        case 'place': {
          const def = TOOL_DEFS[a.tool];
          if (!def) return { ok: false, reason: `unknown tool ${String(a.tool)}` };
          const inv = s.inventory[a.tool] ?? 0;
          const inPalette = s.level.tools.includes(a.tool);
          if (!inPalette && inv <= 0) return { ok: false, reason: `tool ${a.tool} not available in this level` };
          const geo = checkGeometry(a.tool, a.x, a.y, a.x2, a.y2, -1);
          if (typeof geo === 'string') return { ok: false, reason: geo };
          const { x2, y2 } = geo;
          const free = inv > 0;
          if (!free && s.energy < def.cost) return { ok: false, reason: `not enough energy (${Math.floor(s.energy)} < ${def.cost})` };
          begin();
          if (free) s.inventory[a.tool] = inv - 1; else s.energy -= def.cost;
          const node: Node = {
            id: w.nextNodeId++, tool: a.tool, x: a.x, y: a.y,
            placedAt: s.time, expiresAt: def.durationSec === null ? null : s.time + def.durationSec,
          };
          if (x2 !== undefined) { node.x2 = x2; node.y2 = y2; }
          if (a.tool === 'black_hole') node.mass = P.blackHoleStartMass;
          if (free) node.free = true;
          s.nodes.push(node);
          if (s.hint && s.hint.tool === a.tool) s.hint = null;
          computeField(w);
          return { ok: true };
        }
        case 'remove': {
          const i = s.nodes.findIndex((n) => n.id === a.nodeId);
          if (i < 0) return { ok: false, reason: `no node ${a.nodeId}` };
          begin();
          const n = s.nodes[i];
          s.nodes.splice(i, 1);
          if (s.time - n.placedAt <= GRACE_SEC) {
            // just placed: full refund
            if (n.free) s.inventory[n.tool] = (s.inventory[n.tool] ?? 0) + 1;
            else s.energy += TOOL_DEFS[n.tool].cost;
          }
          computeField(w);
          return { ok: true };
        }
        case 'move': {
          const n = s.nodes.find((q) => q.id === a.nodeId);
          if (!n) return { ok: false, reason: `no node ${a.nodeId}` };
          if (s.time - n.placedAt > GRACE_SEC) return { ok: false, reason: `nodes can only be moved within ${GRACE_SEC}s of placing` };
          let mx2 = a.x2, my2 = a.y2;
          if (n.tool === 'wall' && (mx2 === undefined || my2 === undefined)) {
            // translate the wall, keeping its shape
            mx2 = a.x + (n.x2! - n.x); my2 = a.y + (n.y2! - n.y);
          }
          const geo = checkGeometry(n.tool, a.x, a.y, mx2, my2, n.id);
          if (typeof geo === 'string') return { ok: false, reason: geo };
          begin();
          n.x = a.x; n.y = a.y;
          if (n.tool === 'wall') { n.x2 = geo.x2; n.y2 = geo.y2; }
          computeField(w);
          return { ok: true };
        }
        case 'hint': {
          const cost = nextHintCost(s, w.hintsUsed);
          if (s.scoreboard.points < cost) return { ok: false, reason: `a hint costs ${cost} points (you have ${s.scoreboard.points})` };
          const h = computeHint(w, (src) => wrapWorld(cloneWorld(src), () => cloneWorld(src)));
          if (typeof h === 'string') return { ok: false, reason: h };
          begin();
          w.hintsUsed++;
          s.scoreboard.pointsBy.spentHints += cost;
          refreshPoints(s);
          const hint = { ...h, cost, at: s.time };
          s.hint = hint;
          log(w, `Hint (-${cost} points): ${hint.reason}`);
          return { ok: true, hint };
        }
        default:
          return { ok: false, reason: `unknown action ${(a as { type?: string }).type}` };
      }
    },
    step(n = 1): void {
      for (let i = 0; i < n; i++) {
        if (w.s.phase === 'intro') return;
        tickWorld(w);
      }
    },
    runFor(seconds: number): void {
      game.step(Math.round(seconds * TICKS_PER_SECOND));
    },
    help(): string {
      return helpText(w.s);
    },
  };
  return game;
}

export const createGame = ((levelId: number, seed?: number, opts: GameOptions = {}): SimGame =>
  wrapWorld(newWorld(levelId, seed, opts), () => newWorld(levelId, seed, opts))) satisfies GameFactory;

/** Points the next hint will cost in `game` (UI/CLI). */
export function hintCostOf(game: Game): number {
  const w = (game as SimGame).world?.();
  return w ? nextHintCost(w.s, w.hintsUsed) : POINTS.hintCost;
}

const fmtS = (v: number) => `${Math.round(v)}s`;

export function helpText(s: GameState): string {
  const L = s.level;
  const lines: string[] = [];
  lines.push(`LEVEL ${L.id} "${L.name}": ${L.intro}`);
  lines.push(`Board ${s.width}x${s.height} (x right, y down). Continuous play: the clock runs from the first action. Time ${s.time.toFixed(1)}s. `
    + `Energy ${Math.floor(s.energy)} now, +${L.incomePerSec}/s.`);
  lines.push('GOALS (each has its own countdown): ' + L.goals.map((g) => `${g.label} [${g.type} >= ${g.count} within ${fmtS(g.deadlineSec)}, ${g.points} pts]`).join('; '));
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
  lines.push(`LOOP: the grid never stops. Place nodes any time you can afford them; a node can be moved or removed for a full refund within ${GRACE_SEC}s of placing, `
    + 'later it can only be removed (no refund). A goal whose countdown runs out is MISSED (one star less, no time bonus) but still counts when finished. '
    + 'All goals met = level cleared: stars = 3 - missed (min 1). The grid keeps running after that and points keep coming.');
  const el = (Object.entries(POINTS.element) as [Element, number][]).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(', ');
  lines.push(`POINTS: cloud ${POINTS.cloud}, planet ${POINTS.planet}, star ${POINTS.star_ms}, red giant ${POINTS.star_giant}, white dwarf ${POINTS.white_dwarf}, `
    + `neutron star ${POINTS.neutron}, black hole ${POINTS.black_hole}, supernova ${POINTS.supernova}; per element unit produced: ${el}; `
    + `goal met: its points x (1 + time left / countdown). You start with ${POINTS.startPoints}.`);
  lines.push(`HINT: {"type":"hint"} suggests a placement for the most urgent goal; costs ${POINTS.hintCost} x (1 + hints used so far) points.`);
  if (L.rewards) lines.push('REWARD on clear: ' + Object.entries(L.rewards).map(([k, v]) => `${k} x${v}`).join(', ')
    + ' (free uses, added to state.inventory; carry them into another level with createGame(levelId, seed, { inventory }))');
  const avail = new Set<ToolId>([...L.tools, ...(Object.keys(s.inventory) as ToolId[]).filter((k) => (s.inventory[k] ?? 0) > 0)]);
  lines.push('TOOLS:');
  for (const t of avail) {
    const d = TOOL_DEFS[t];
    const inv = s.inventory[t] ? ` (free x${s.inventory[t]})` : '';
    lines.push(`  ${t}: cost ${d.cost}${inv}, radius ${d.radius}, ${d.durationSec === null ? 'permanent' : d.durationSec + 's'}. ${d.description}`);
  }
  lines.push(`ACTIONS (JSON): {"type":"place","tool":"repulsor","x":${Math.round(s.width / 2)},"y":${Math.round(s.height / 2)}} | wall needs "x2","y2" (length ${P.wallMinLen}-${P.wallMaxLen}) | nodes of one tool must be ${P.nodeMinSpacing}+ apart | {"type":"remove","nodeId":1} | {"type":"move","nodeId":1,"x":${Math.round(s.width / 2 + 10)},"y":${Math.round(s.height / 2 - 5)}} (within ${GRACE_SEC}s of placing; walls keep their shape unless x2,y2 given) | {"type":"hint"} | {"type":"start"} | {"type":"restart"}`);
  return lines.join('\n');
}

/**
 * Replay a timeline: starts the clock, applies each action when game time reaches its t (sorted, stable),
 * then keeps running until `untilSec` (default: the last action). With `stopWhenCleared`, stops as soon as
 * the level is cleared (after all actions due by then).
 */
export function playTimeline(game: Game, timeline: TimedAction[], opts: { untilSec?: number; stopWhenCleared?: boolean } = {}): ActionResult[] {
  const out: ActionResult[] = [];
  if (game.state().phase === 'intro') game.apply({ type: 'start' });
  const acts = timeline.map((a, i) => ({ a, i })).sort((p, q) => p.a.t - q.a.t || p.i - q.i).map((p) => p.a);
  const until = opts.untilSec ?? (acts.length ? acts[acts.length - 1].t : 0);
  const stepTo = (t: number): boolean => {
    const target = Math.round(t * TICKS_PER_SECOND);
    while (game.state().totalTick < target) {
      if (opts.stopWhenCleared && game.state().phase === 'cleared') return false;
      game.step(1);
    }
    return true;
  };
  for (const ta of acts) {
    if (!stepTo(ta.t)) return out;
    out.push(game.apply(ta.action));
  }
  stepTo(Math.max(until, game.state().time));
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
  mix(s.time); mix(s.totalTick); mix(s.energy); mix(s.scoreboard.points);
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
  const w = (game as SimGame).world();
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

/**
 * Mock implementation of the v0.3 Game contract (src/sim/types.ts) used until the
 * real simulation lands. Produces plausible-looking continuous-play state (countdown
 * goals, points, hints, grace-period node editing) so render/UI code can be built and
 * smoke-tested independently. Not physically meaningful.
 */
import type {
  Action,
  ActionResult,
  Body,
  BodyKind,
  Element,
  Game,
  GameFactory,
  GameOptions,
  GameState,
  Goal,
  GoalStatus,
  Hint,
  LevelDef,
  Node,
  NovaEvent,
  Particle,
  Phase,
  Scoreboard,
  ToolId,
} from '../sim/types';
import { ELEMENTS, GRACE_SEC, GRID_H, GRID_W, TICKS_PER_SECOND, WORLD_H, WORLD_W } from '../sim/types';
import { TOOL_DEFS } from './toolDefs';

// ---------------------------------------------------------------------------
// deterministic-ish RNG (mulberry32) so a given seed looks stable frame-to-frame
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_BODY_KINDS: BodyKind[] = [
  'cloud', 'planet', 'star_ms', 'star_giant', 'white_dwarf', 'neutron', 'black_hole',
];

/** Mock points awarded when a body of this kind first forms. Not the real balance; the real
 * sim's src/sim/params.ts POINTS table replaces this once it lands. */
const FORM_POINTS: Record<BodyKind, number> = {
  cloud: 10, planet: 25, star_ms: 50, star_giant: 70, white_dwarf: 90, neutron: 120, black_hole: 150,
};
const NOVA_POINTS = 200;
const ELEMENT_POINTS_PER_UNIT = 1;
const HINT_BASE_COST = 50;

function emptyComposition(): Record<Element, number> {
  const c = {} as Record<Element, number>;
  for (const el of ELEMENTS) c[el] = 0;
  return c;
}

function emptyStarsByKind(): Record<BodyKind, number> {
  const s = {} as Record<BodyKind, number>;
  for (const k of ALL_BODY_KINDS) s[k] = 0;
  return s;
}

function emptyScoreboard(): Scoreboard {
  return {
    cloudsFormed: 0,
    starsByKind: emptyStarsByKind(),
    novae: 0,
    elements: emptyComposition(),
    points: 0,
    pointsBy: { clouds: 0, planets: 0, stars: 0, novae: 0, elements: 0, goals: 0, spentHints: 0 },
  };
}

function stubLevel(levelId: number, seed: number): LevelDef {
  const names = ['First Light', 'Nursery', 'Ignition', 'Forge', 'Nova'];
  const intros = [
    'A gravity field pulses in the dark. Squeeze the drifting particles into a cloud before the clock runs out.',
    'Build walls to steer particles and form more clouds — then let one collapse into a planet.',
    'Pack enough mass together and it will ignite. Form a main-sequence star.',
    'Give a star time to fuse. Watch hydrogen turn to helium as it burns.',
    'Push a giant past its limit and watch it go supernova, scattering heavy elements.',
  ];
  const tools: ToolId[][] = [
    ['repulsor'],
    ['repulsor', 'wall'],
    ['repulsor', 'wall', 'lens'],
    ['repulsor', 'wall', 'lens', 'pulse'],
    ['repulsor', 'wall', 'lens', 'pulse'],
  ];
  const goals: Goal[][] = [
    [{ type: 'clouds', count: 1, deadlineSec: 45, points: 100, label: 'Form 1 particle cloud' }],
    [
      { type: 'clouds', count: 2, deadlineSec: 40, points: 80, label: 'Form 2 particle clouds' },
      { type: 'planets', count: 1, deadlineSec: 80, points: 150, label: 'Form 1 planet' },
    ],
    [{ type: 'star_kind', count: 1, kind: 'star_ms', deadlineSec: 90, points: 250, label: 'Ignite 1 star' }],
    [
      { type: 'star_kind', count: 1, kind: 'star_ms', deadlineSec: 60, points: 200, label: 'Ignite 1 star' },
      { type: 'element', count: 40, el: 'He', deadlineSec: 120, points: 150, label: 'Produce 40 helium' },
    ],
    [
      { type: 'novae', count: 1, deadlineSec: 150, points: 300, label: '1 supernova' },
      { type: 'element', count: 20, els: ['C', 'O'], deadlineSec: 140, points: 200, label: 'Produce 20 carbon+oxygen' },
    ],
  ];
  return {
    id: levelId,
    name: names[levelId - 1] ?? `Level ${levelId}`,
    intro: intros[levelId - 1] ?? 'Squeeze the particles into something new.',
    seed,
    particleCount: 1500,
    initialMix: { H: 0.7, He: 0.22, C: 0.03, O: 0.03, Fe: 0.015, heavy: 0.005 },
    startingEnergy: 40,
    incomePerSec: 3,
    ambientGravity: 0.4,
    tools: tools[levelId - 1] ?? ['repulsor'],
    goals: goals[levelId - 1] ?? [{ type: 'clouds', count: 1, deadlineSec: 45, points: 100, label: 'Form 1 cloud' }],
    rewards: levelId === 5 ? { black_hole: 1 } : undefined,
  };
}

function weightedElement(rand: () => number, mix: Partial<Record<Element, number>>): Element {
  const total = ELEMENTS.reduce((s, el) => s + (mix[el] ?? 0), 0) || 1;
  let r = rand() * total;
  for (const el of ELEMENTS) {
    r -= mix[el] ?? 0;
    if (r <= 0) return el;
  }
  return 'H';
}

function makeParticles(level: LevelDef, rand: () => number, w: number, h: number): Particle[] {
  const arr: Particle[] = [];
  for (let i = 0; i < level.particleCount; i++) {
    arr.push({
      x: rand() * w,
      y: rand() * h,
      vx: (rand() - 0.5) * 0.6,
      vy: (rand() - 0.5) * 0.6,
      el: weightedElement(rand, level.initialMix),
      bodyId: 0,
    });
  }
  return arr;
}

function captureNearby(particles: Particle[], bodies: Body[]) {
  for (const b of bodies) {
    let captured = 0;
    for (const p of particles) {
      if (captured > 60) break;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      if (dx * dx + dy * dy < (b.radius + 5) * (b.radius + 5) && p.bodyId === 0) {
        p.bodyId = b.id;
        captured++;
      }
    }
  }
}

function radiusFor(kind: BodyKind): number {
  return { cloud: 5, planet: 3.2, star_ms: 4.5, star_giant: 6, white_dwarf: 3, neutron: 2.4, black_hole: 4.5 }[kind] ?? 4;
}

function computeField(t: number, ambientGravity: number, nodes: Node[], w: number, h: number): Float32Array {
  const field = new Float32Array(GRID_W * GRID_H);
  const cx = GRID_W / 2;
  const cy = GRID_H / 2;
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const dx = (gx - cx) / GRID_W;
      const dy = (gy - cy) / GRID_H;
      const centerPull = ambientGravity * (1 - Math.min(1, Math.hypot(dx, dy) * 1.6));
      const wave = 0.18 * Math.sin(gx * 0.35 + t * 0.6) * Math.cos(gy * 0.3 - t * 0.45) * (0.6 + 0.4 * Math.sin(t * 0.2));
      let nodeContribution = 0;
      const wx = (gx / GRID_W) * w;
      const wy = (gy / GRID_H) * h;
      for (const n of nodes) {
        const ndx = wx - n.x;
        const ndy = wy - n.y;
        const d = Math.hypot(ndx, ndy) + 1;
        const sign = n.tool === 'lens' || n.tool === 'black_hole' ? 1 : -1;
        nodeContribution += (sign * 6) / (d * 0.5 + 1);
      }
      field[gy * GRID_W + gx] = centerPull + wave + nodeContribution * 0.05;
    }
  }
  return field;
}

/** Mirrors src/levels/goals.ts's goalValue() shape against this mock's own bodies/scoreboard. */
const STARS: BodyKind[] = ['star_ms', 'star_giant', 'white_dwarf', 'neutron'];
function goalValue(bodies: Body[], sb: Scoreboard, g: Goal): number {
  switch (g.type) {
    case 'clouds': return bodies.length;
    case 'planets': return bodies.filter((b) => b.kind !== 'cloud').length;
    case 'stars': return bodies.filter((b) => STARS.includes(b.kind)).length;
    case 'star_kind': return bodies.filter((b) => b.kind === g.kind).length;
    case 'element': {
      const els = g.els ?? (g.el ? [g.el] : []);
      let t = 0;
      for (const e of els) t += sb.elements[e];
      return Math.floor(t);
    }
    case 'novae': return sb.novae;
    case 'density': return 0;
    default: return 0;
  }
}

class MockGame implements Game {
  private levelId: number;
  private seed: number;
  private rand: () => number;
  private level: LevelDef;
  private width: number;
  private height: number;
  private phase: Phase = 'intro';
  private time = 0;
  private totalTick = 0;
  private energy: number;
  private energyCarry = 0;
  private inventory: Partial<Record<ToolId, number>> = {};
  private particles: Particle[];
  private bodies: Body[];
  private nodes: Node[];
  private nextNodeId = 100;
  private nextBodyId = 100;
  private scoreboard: Scoreboard;
  private goals: GoalStatus[];
  private stars = 0;
  private hint: Hint | null = null;
  private hintsUsed = 0;
  private events: NovaEvent[] = [];
  private log: string[] = [];
  private formationCooldown: number;
  private opts: GameOptions;

  constructor(levelId: number, seed = Date.now() & 0xffffffff, opts: GameOptions = {}) {
    this.levelId = levelId;
    this.seed = seed;
    this.opts = opts;
    this.rand = mulberry32(seed);
    this.level = opts.level ?? stubLevel(levelId, seed);
    this.width = opts.world?.width ?? WORLD_W;
    this.height = opts.world?.height ?? WORLD_H;
    this.energy = this.level.startingEnergy;
    this.inventory = { ...(opts.inventory ?? {}) };
    this.particles = makeParticles(this.level, this.rand, this.width, this.height);
    this.bodies = [];
    this.nodes = [];
    this.scoreboard = emptyScoreboard();
    this.goals = this.level.goals.map((goal) => ({ goal, current: 0, met: false, missed: false, remainingSec: goal.deadlineSec }));
    this.log = [`${this.level.name} charted.`];
    this.formationCooldown = 90 + this.rand() * 120;
  }

  private recomputePoints() {
    const p = this.scoreboard.pointsBy;
    const raw = p.clouds + p.planets + p.stars + p.novae + p.elements + p.goals - p.spentHints;
    this.scoreboard.points = Math.max(0, Math.round(raw));
  }

  state(): GameState {
    return {
      levelId: this.levelId,
      level: this.level,
      seed: this.seed,
      phase: this.phase,
      time: this.time,
      totalTick: this.totalTick,
      energy: this.energy,
      inventory: this.inventory,
      particles: this.particles,
      bodies: this.bodies,
      nodes: this.nodes,
      field: computeField(this.time, this.level.ambientGravity, this.nodes, this.width, this.height),
      gridW: GRID_W,
      gridH: GRID_H,
      width: this.width,
      height: this.height,
      scoreboard: this.scoreboard,
      goals: this.goals,
      stars: this.stars,
      hint: this.hint,
      events: this.events,
      log: this.log.slice(-8),
    };
  }

  private toolCost(tool: ToolId): number {
    return TOOL_DEFS[tool]?.cost ?? 10;
  }

  private inBoard(x: number, y: number): boolean {
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= this.width && y <= this.height;
  }

  private isFresh(node: Node): boolean {
    return this.time - node.placedAt <= GRACE_SEC;
  }

  apply(a: Action): ActionResult {
    switch (a.type) {
      case 'start': {
        if (this.phase !== 'intro') return { ok: false, reason: `already ${this.phase}` };
        this.phase = 'playing';
        this.log.push('Level started.');
        return { ok: true };
      }
      case 'place': {
        if (this.phase === 'intro') return { ok: false, reason: 'start the level first' };
        const def = TOOL_DEFS[a.tool];
        if (!def) return { ok: false, reason: `unknown tool ${String(a.tool)}` };
        if (!this.inBoard(a.x, a.y)) return { ok: false, reason: 'position outside board' };
        if (a.tool === 'wall') {
          if (a.x2 === undefined || a.y2 === undefined) return { ok: false, reason: 'wall needs an end point' };
          if (!this.inBoard(a.x2, a.y2)) return { ok: false, reason: 'wall endpoint outside board' };
        }
        const inv = this.inventory[a.tool] ?? 0;
        const inPalette = this.level.tools.includes(a.tool);
        if (!inPalette && inv <= 0) return { ok: false, reason: `tool ${a.tool} not available in this level` };
        const free = inv > 0;
        if (!free && this.energy < def.cost) return { ok: false, reason: `not enough energy (${Math.floor(this.energy)} < ${def.cost})` };
        if (free) this.inventory[a.tool] = inv - 1; else this.energy -= def.cost;
        const node: Node = {
          id: this.nextNodeId++, tool: a.tool, x: a.x, y: a.y,
          placedAt: this.time,
          expiresAt: def.durationSec != null ? this.time + def.durationSec : null,
        };
        if (a.x2 !== undefined) { node.x2 = a.x2; node.y2 = a.y2; }
        if (a.tool === 'black_hole') node.mass = 100;
        if (free) node.free = true;
        this.nodes.push(node);
        this.log.push(`Placed ${def.name}.`);
        // Clear the ghost hint once the player places (roughly) what it suggested.
        if (this.hint && this.hint.tool === a.tool && Math.hypot(this.hint.x - a.x, this.hint.y - a.y) < 6) {
          this.hint = null;
        }
        return { ok: true };
      }
      case 'remove': {
        const i = this.nodes.findIndex((n) => n.id === a.nodeId);
        if (i < 0) return { ok: false, reason: `no node ${a.nodeId}` };
        const n = this.nodes[i];
        this.nodes.splice(i, 1);
        if (this.isFresh(n)) {
          if (n.free) this.inventory[n.tool] = (this.inventory[n.tool] ?? 0) + 1;
          else this.energy += TOOL_DEFS[n.tool].cost;
        }
        this.log.push(`Removed ${TOOL_DEFS[n.tool].name}.`);
        return { ok: true };
      }
      case 'move': {
        const n = this.nodes.find((q) => q.id === a.nodeId);
        if (!n) return { ok: false, reason: `no node ${a.nodeId}` };
        if (!this.isFresh(n)) return { ok: false, reason: 'grace period expired — this node can no longer be moved' };
        if (!this.inBoard(a.x, a.y)) return { ok: false, reason: 'position outside board' };
        n.x = a.x; n.y = a.y;
        if (n.tool === 'wall') { n.x2 = a.x2 ?? n.x2; n.y2 = a.y2 ?? n.y2; }
        return { ok: true };
      }
      case 'hint': {
        if (this.phase === 'intro') return { ok: false, reason: 'start the level first' };
        const cost = Math.round(HINT_BASE_COST * (1 + 0.5 * this.hintsUsed));
        if (this.scoreboard.points < cost) return { ok: false, reason: `not enough points for a hint (need ${cost}, have ${this.scoreboard.points})` };
        let goalIndex = this.goals.findIndex((g) => !g.met);
        if (goalIndex < 0) goalIndex = 0;
        const target = this.goals[goalIndex]?.goal;
        const tool: ToolId = this.level.tools.includes('repulsor') ? 'repulsor' : this.level.tools[0] ?? 'repulsor';
        const def = TOOL_DEFS[tool];
        const x = this.width * (0.3 + this.rand() * 0.4);
        const y = this.height * (0.3 + this.rand() * 0.4);
        const hint: Hint = {
          tool, x, y,
          ...(tool === 'wall' ? { x2: Math.min(this.width, x + 18), y2: y } : {}),
          reason: target ? `Squeeze gas here to feed "${target.label}".` : `A ${def.name.toLowerCase()} here should help your score.`,
          goalIndex,
          cost,
          at: this.time,
        };
        this.hintsUsed++;
        this.scoreboard.pointsBy.spentHints += cost;
        this.recomputePoints();
        this.hint = hint;
        this.log.push(`Hint used (−${cost} pts).`);
        return { ok: true, hint };
      }
      case 'restart': {
        this.rand = mulberry32(this.seed);
        this.phase = 'intro';
        this.time = 0;
        this.totalTick = 0;
        this.energyCarry = 0;
        this.energy = this.level.startingEnergy;
        this.inventory = { ...(this.opts.inventory ?? {}) };
        this.particles = makeParticles(this.level, this.rand, this.width, this.height);
        this.bodies = [];
        captureNearby(this.particles, this.bodies);
        this.nodes = [];
        this.scoreboard = emptyScoreboard();
        this.goals = this.level.goals.map((goal) => ({ goal, current: 0, met: false, missed: false, remainingSec: goal.deadlineSec }));
        this.stars = 0;
        this.hint = null;
        this.hintsUsed = 0;
        this.events = [];
        this.log = ['Restarted.'];
        this.formationCooldown = 90 + this.rand() * 120;
        return { ok: true };
      }
      default:
        return { ok: false, reason: 'unknown action' };
    }
  }

  private maybeFormBody() {
    this.formationCooldown--;
    if (this.formationCooldown > 0) return;
    this.formationCooldown = 90 + this.rand() * 150;
    const existingReal = this.bodies.filter((b) => b.kind !== 'cloud').length;
    let kind: BodyKind = 'cloud';
    const r = this.rand();
    if (this.bodies.length >= 1 && r < 0.35) kind = 'planet';
    if (existingReal >= 1 && r < 0.15) kind = 'star_ms';
    const x = this.width * (0.15 + this.rand() * 0.7);
    const y = this.height * (0.15 + this.rand() * 0.7);
    const mass = { cloud: 22, planet: 46, star_ms: 150, star_giant: 0, white_dwarf: 0, neutron: 0, black_hole: 0 }[kind] || 22;
    const comp = emptyComposition();
    comp.H = mass * 0.7; comp.He = mass * 0.25; comp.C = mass * 0.05;
    const body: Body = {
      id: this.nextBodyId++, kind, x, y, vx: 0, vy: 0, mass, radius: radiusFor(kind),
      composition: comp, age: 0, progress: this.rand() * 0.3,
    };
    this.bodies.push(body);
    captureNearby(this.particles, [body]);
    const pts = FORM_POINTS[kind];
    if (kind === 'cloud') { this.scoreboard.cloudsFormed++; this.scoreboard.pointsBy.clouds += pts; }
    else if (kind === 'planet') { this.scoreboard.pointsBy.planets += pts; }
    else { this.scoreboard.starsByKind[kind] = (this.scoreboard.starsByKind[kind] ?? 0) + 1; this.scoreboard.pointsBy.stars += pts; }
    this.recomputePoints();
    this.log.push(`${kind === 'cloud' ? 'Cloud' : kind === 'planet' ? 'Planet' : 'Star'} formed (+${pts}).`);
  }

  private maybeNova() {
    if (this.bodies.length < 2) return;
    if (this.rand() > 0.0015) return;
    const body = this.bodies[Math.floor(this.rand() * this.bodies.length)];
    this.events.push({ t: this.time, x: body.x, y: body.y, mass: 40, kind: 'supernova' });
    this.scoreboard.novae++;
    this.scoreboard.pointsBy.novae += NOVA_POINTS;
    this.recomputePoints();
    this.log.push(`Supernova! (+${NOVA_POINTS})`);
    this.events = this.events.filter((e) => this.time - e.t < 5);
  }

  private evaluateGoals() {
    let anyNewlyMissed = false;
    for (const gs of this.goals) {
      gs.current = goalValue(this.bodies, this.scoreboard, gs.goal);
      if (!gs.met && gs.current >= gs.goal.count) {
        gs.met = true;
        gs.metAt = this.time;
        const earlyFrac = gs.goal.deadlineSec > 0 ? Math.max(0, gs.remainingSec / gs.goal.deadlineSec) : 0;
        const bonus = Math.round(gs.goal.points * (1 + earlyFrac * 0.5));
        this.scoreboard.pointsBy.goals += bonus;
        this.recomputePoints();
        this.log.push(`Goal met: ${gs.goal.label} (+${bonus}).`);
      }
      if (!gs.met) {
        gs.remainingSec = Math.max(0, gs.goal.deadlineSec - this.time);
        if (gs.remainingSec <= 0 && !gs.missed) { gs.missed = true; anyNewlyMissed = true; this.log.push(`Goal missed: ${gs.goal.label}.`); }
      }
    }
    if (anyNewlyMissed) { /* latched; level stays completable */ }
    if (this.phase === 'playing' && this.goals.every((g) => g.met)) {
      this.phase = 'cleared';
      const missed = this.goals.filter((g) => g.missed).length;
      this.stars = Math.max(1, 3 - missed);
      this.log.push(`Galaxy organized! ${'★'.repeat(this.stars)}${'☆'.repeat(3 - this.stars)}`);
    }
  }

  step(n = 1): void {
    if (this.phase === 'intro') return;
    for (let i = 0; i < n; i++) {
      this.totalTick++;
      this.time = this.totalTick / TICKS_PER_SECOND;
      for (const p of this.particles) {
        if (p.bodyId !== 0) continue;
        p.vx += (this.rand() - 0.5) * 0.05;
        p.vy += (this.rand() - 0.5) * 0.05;
        p.vx *= 0.98; p.vy *= 0.98;
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) { p.x = 0; p.vx *= -1; }
        if (p.x > this.width) { p.x = this.width; p.vx *= -1; }
        if (p.y < 0) { p.y = 0; p.vy *= -1; }
        if (p.y > this.height) { p.y = this.height; p.vy *= -1; }
      }
      // continuous element trickle, small
      if (this.totalTick % 30 === 0) {
        for (const el of ELEMENTS) {
          const d = this.rand() * 0.6 * (this.bodies.length > 0 ? 1 : 0.2);
          this.scoreboard.elements[el] += d;
          this.scoreboard.pointsBy.elements += d * ELEMENT_POINTS_PER_UNIT;
        }
        this.recomputePoints();
      }
      this.maybeFormBody();
      this.maybeNova();
      // continuous income
      this.energyCarry += this.level.incomePerSec / TICKS_PER_SECOND;
      const whole = Math.floor(this.energyCarry);
      if (whole > 0) { this.energy += whole; this.energyCarry -= whole; }
      // expire timed nodes (pulse)
      if (this.nodes.some((nd) => nd.expiresAt != null && this.time >= nd.expiresAt)) {
        this.nodes = this.nodes.filter((nd) => nd.expiresAt == null || this.time < nd.expiresAt);
      }
      if (this.totalTick % 5 === 0) this.evaluateGoals();
      this.events = this.events.filter((e) => this.time - e.t < 5);
    }
  }

  runFor(seconds: number): void {
    this.step(Math.max(0, Math.round(seconds * TICKS_PER_SECOND)));
  }

  help(): string {
    return `Mock game for level ${this.levelId} (v0.3, render-side placeholder). Continuous play: place tools any time; goals count down from level start.`;
  }
}

export const createMockGame: GameFactory = (levelId: number, seed?: number) => new MockGame(levelId, seed);

/** Matches src/sim/game.ts's real createGame signature (3rd opts arg) so main.ts can call
 * either factory uniformly. */
export const createMockGameWithOpts = (levelId: number, seed?: number, opts?: GameOptions): Game =>
  new MockGame(levelId, seed, opts);

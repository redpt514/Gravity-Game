/**
 * Mock implementation of the Game contract (src/sim/types.ts) used until the
 * real simulation lands. Produces plausible-looking state so render/UI code
 * can be built and smoke-tested independently. Not physically meaningful.
 */
import type {
  Action,
  ActionResult,
  Body,
  BodyKind,
  Element,
  Game,
  GameFactory,
  GameState,
  Goal,
  LevelDef,
  Node,
  NovaEvent,
  Particle,
  Phase,
  Scoreboard,
  ToolId,
} from '../sim/types';
import { ELEMENTS, GRID_H, GRID_W, WORLD_H, WORLD_W } from '../sim/types';
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
  'cloud',
  'planet',
  'star_ms',
  'star_giant',
  'white_dwarf',
  'neutron',
  'black_hole',
];

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

function stubLevel(levelId: number, seed: number): LevelDef {
  const rounds = [2, 3, 3, 4, 5][levelId - 1] ?? 3;
  const names = ['First Light', 'Nursery', 'Ignition', 'Forge', 'Nova'];
  const intros = [
    'A gravity field pulses in the dark. Squeeze the drifting particles into a cloud.',
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
    [{ type: 'clouds', count: 1, byRound: 2, label: 'Form 1 particle cloud' }],
    [
      { type: 'clouds', count: 2, byRound: 2, label: 'Form 2 particle clouds' },
      { type: 'planets', count: 1, byRound: 3, label: 'Form 1 planet' },
    ],
    [{ type: 'star_kind', count: 1, kind: 'star_ms', byRound: 3, label: 'Ignite 1 star' }],
    [
      { type: 'star_kind', count: 1, kind: 'star_ms', byRound: 2, label: 'Ignite 1 star' },
      { type: 'element', count: 40, el: 'He', byRound: 4, label: 'Produce 40 helium' },
    ],
    [
      { type: 'novae', count: 1, byRound: 4, label: '1 supernova' },
      { type: 'element', count: 20, el: 'O', byRound: 5, label: 'Produce 20 carbon+oxygen' },
    ],
  ];
  return {
    id: levelId,
    name: names[levelId - 1] ?? `Level ${levelId}`,
    intro: intros[levelId - 1] ?? 'Squeeze the particles into something new.',
    seed,
    particleCount: 1500,
    initialMix: { H: 0.7, He: 0.22, C: 0.03, O: 0.03, Fe: 0.015, heavy: 0.005 },
    rounds,
    ticksPerRound: 600,
    startingEnergy: 40,
    incomePerRound: 15,
    ambientGravity: 0.4,
    tools: tools[levelId - 1] ?? ['repulsor'],
    goals: goals[levelId - 1] ?? [{ type: 'clouds', count: 1, byRound: 2, label: 'Form 1 cloud' }],
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

function makeParticles(level: LevelDef, rand: () => number): Particle[] {
  const arr: Particle[] = [];
  for (let i = 0; i < level.particleCount; i++) {
    arr.push({
      x: rand() * WORLD_W,
      y: rand() * WORLD_H,
      vx: (rand() - 0.5) * 0.6,
      vy: (rand() - 0.5) * 0.6,
      el: weightedElement(rand, level.initialMix),
      bodyId: 0,
    });
  }
  return arr;
}

function makeBodies(rand: () => number): Body[] {
  const kinds: BodyKind[] = ['cloud', 'star_ms', 'planet'];
  const radii: Record<string, number> = { cloud: 6, star_ms: 4.5, planet: 3 };
  const masses: Record<string, number> = { cloud: 22, star_ms: 150, planet: 46 };
  return kinds.map((kind, i) => {
    const comp = emptyComposition();
    comp.H = masses[kind] * 0.7;
    comp.He = masses[kind] * 0.25;
    comp.C = masses[kind] * 0.05;
    return {
      id: i + 1,
      kind,
      x: WORLD_W * (0.25 + i * 0.25) + (rand() - 0.5) * 10,
      y: WORLD_H * (0.35 + (i % 2) * 0.3) + (rand() - 0.5) * 10,
      vx: 0,
      vy: 0,
      mass: masses[kind],
      radius: radii[kind],
      composition: comp,
      age: 0,
      progress: rand() * 0.4,
    };
  });
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

function makeNodes(level: LevelDef): Node[] {
  const nodes: Node[] = [];
  if (level.tools.includes('repulsor')) {
    nodes.push({
      id: 1,
      tool: 'repulsor',
      x: WORLD_W * 0.65,
      y: WORLD_H * 0.25,
      roundsLeft: null,
      placedRound: 0,
    });
  }
  if (level.tools.includes('lens')) {
    nodes.push({
      id: 2,
      tool: 'lens',
      x: WORLD_W * 0.4,
      y: WORLD_H * 0.7,
      roundsLeft: null,
      placedRound: 0,
    });
  }
  return nodes;
}

function computeField(t: number, ambientGravity: number, nodes: Node[]): Float32Array {
  const field = new Float32Array(GRID_W * GRID_H);
  const cx = GRID_W / 2;
  const cy = GRID_H / 2;
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const dx = (gx - cx) / GRID_W;
      const dy = (gy - cy) / GRID_H;
      const centerPull = ambientGravity * (1 - Math.min(1, Math.hypot(dx, dy) * 1.6));
      const wave =
        0.18 *
        Math.sin(gx * 0.35 + t * 0.6) *
        Math.cos(gy * 0.3 - t * 0.45) *
        (0.6 + 0.4 * Math.sin(t * 0.2));
      let nodeContribution = 0;
      const wx = (gx / GRID_W) * WORLD_W;
      const wy = (gy / GRID_H) * WORLD_H;
      for (const n of nodes) {
        const ndx = wx - n.x;
        const ndy = wy - n.y;
        const d = Math.hypot(ndx, ndy) + 1;
        const sign = n.tool === 'lens' ? 1 : -1;
        nodeContribution += (sign * 6) / (d * 0.5 + 1);
      }
      field[gy * GRID_W + gx] = centerPull + wave + nodeContribution * 0.05;
    }
  }
  return field;
}

class MockGame implements Game {
  private levelId: number;
  private seed: number;
  private rand: () => number;
  private level: LevelDef;
  private phase: Phase = 'intro';
  private round = 1;
  private tick = 0;
  private totalTick = 0;
  private energy: number;
  private inventory: Partial<Record<ToolId, number>> = {};
  private particles: Particle[];
  private bodies: Body[];
  private nodes: Node[];
  private nextNodeId = 100;
  private scoreboard: Scoreboard;
  private goalProgress: number[];
  private events: NovaEvent[] = [];
  private log: string[] = [];

  constructor(levelId: number, seed = Date.now() & 0xffffffff) {
    this.levelId = levelId;
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.level = stubLevel(levelId, seed);
    this.energy = this.level.startingEnergy;
    this.particles = makeParticles(this.level, this.rand);
    this.bodies = makeBodies(this.rand);
    captureNearby(this.particles, this.bodies);
    this.nodes = makeNodes(this.level);
    this.scoreboard = {
      cloudsFormed: 1,
      starsByKind: emptyStarsByKind(),
      novae: 0,
      elements: emptyComposition(),
      score: 0,
    };
    this.scoreboard.starsByKind.cloud = 1;
    this.scoreboard.starsByKind.star_ms = 1;
    this.scoreboard.starsByKind.planet = 1;
    this.goalProgress = this.level.goals.map(() => 0);
    this.log.push(`Level ${levelId} loaded (mock).`);
  }

  private goalsView() {
    return this.level.goals.map((goal, i) => ({
      goal,
      current: Math.min(this.goalProgress[i], goal.count),
      met: this.goalProgress[i] >= goal.count,
    }));
  }

  state(): GameState {
    const t = this.totalTick / 30;
    return {
      levelId: this.levelId,
      level: this.level,
      seed: this.seed,
      phase: this.phase,
      round: this.round,
      tick: this.tick,
      totalTick: this.totalTick,
      energy: this.energy,
      inventory: this.inventory,
      particles: this.particles,
      bodies: this.bodies,
      nodes: this.nodes,
      field: computeField(t, this.level.ambientGravity, this.nodes),
      gridW: GRID_W,
      gridH: GRID_H,
      width: WORLD_W,
      height: WORLD_H,
      scoreboard: this.scoreboard,
      goals: this.goalsView(),
      events: this.events,
      log: this.log.slice(-6),
    };
  }

  private toolCost(tool: ToolId): number {
    return TOOL_DEFS[tool]?.cost ?? 10;
  }

  /** intro/roundEnd auto-dismiss to plan, as 'place'/'remove'/'endRound' imply per the contract. */
  private dismissToPlay() {
    if (this.phase === 'intro') {
      this.phase = 'plan';
    } else if (this.phase === 'roundEnd') {
      this.advancePastRoundEnd();
    }
  }

  private advancePastRoundEnd() {
    const failed = this.goalsView().some((g) => !g.met && g.goal.byRound <= this.round);
    if (failed) {
      this.phase = 'lost';
      this.log.push('Goal missed. Level lost.');
      return;
    }
    if (this.round >= this.level.rounds) {
      this.phase = 'won';
      this.log.push('Level complete!');
      return;
    }
    // decay/expire round-scoped nodes (pulse) between rounds
    this.nodes = this.nodes.filter((n) => {
      if (n.roundsLeft == null) return true;
      n.roundsLeft -= 1;
      return n.roundsLeft > 0;
    });
    this.round += 1;
    this.phase = 'plan';
  }

  apply(a: Action): ActionResult {
    switch (a.type) {
      case 'place': {
        this.dismissToPlay();
        if (this.phase !== 'plan') return { ok: false, reason: 'not in plan phase' };
        const inv = this.inventory[a.tool] ?? 0;
        const cost = this.toolCost(a.tool);
        let free = false;
        if (inv > 0) {
          this.inventory[a.tool] = inv - 1;
          free = true;
        } else {
          if (this.energy < cost) return { ok: false, reason: 'not enough energy' };
          this.energy -= cost;
        }
        this.nodes.push({
          id: this.nextNodeId++,
          tool: a.tool,
          x: a.x,
          y: a.y,
          x2: a.x2,
          y2: a.y2,
          roundsLeft: TOOL_DEFS[a.tool]?.durationRounds ?? null,
          placedRound: this.round,
          mass: a.tool === 'black_hole' ? 20 : undefined,
          free,
        });
        this.log.push(`Placed ${a.tool}.`);
        return { ok: true };
      }
      case 'remove': {
        this.dismissToPlay();
        const idx = this.nodes.findIndex((n) => n.id === a.nodeId);
        if (idx === -1) return { ok: false, reason: 'no such node' };
        const node = this.nodes[idx];
        if (node.placedRound === this.round) {
          if (node.free) {
            this.inventory[node.tool] = (this.inventory[node.tool] ?? 0) + 1;
          } else {
            this.energy += Math.floor(this.toolCost(node.tool) * 0.5);
          }
        }
        this.nodes.splice(idx, 1);
        this.log.push(`Removed ${node.tool}.`);
        return { ok: true };
      }
      case 'endRound': {
        this.dismissToPlay();
        if (this.phase !== 'plan') return { ok: false, reason: `cannot endRound from ${this.phase}` };
        this.phase = 'running';
        this.tick = 0;
        this.events = [];
        this.log.push(`Round ${this.round} started.`);
        return { ok: true };
      }
      case 'start': {
        this.dismissToPlay();
        return { ok: true };
      }
      case 'restart': {
        this.phase = 'intro';
        this.round = 1;
        this.tick = 0;
        this.totalTick = 0;
        this.rand = mulberry32(this.seed);
        this.energy = this.level.startingEnergy;
        this.inventory = {};
        this.particles = makeParticles(this.level, this.rand);
        this.bodies = makeBodies(this.rand);
        captureNearby(this.particles, this.bodies);
        this.nodes = makeNodes(this.level);
        this.scoreboard = {
          cloudsFormed: 1,
          starsByKind: emptyStarsByKind(),
          novae: 0,
          elements: emptyComposition(),
          score: 0,
        };
        this.scoreboard.starsByKind.cloud = 1;
        this.scoreboard.starsByKind.star_ms = 1;
        this.scoreboard.starsByKind.planet = 1;
        this.goalProgress = this.level.goals.map(() => 0);
        this.log = ['Restarted.'];
        return { ok: true };
      }
    }
  }

  step(n = 1): boolean {
    if (this.phase !== 'running') return false;
    for (let i = 0; i < n; i++) {
      this.tick++;
      this.totalTick++;
      for (const p of this.particles) {
        if (p.bodyId !== 0) continue;
        p.vx += (this.rand() - 0.5) * 0.05;
        p.vy += (this.rand() - 0.5) * 0.05;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) { p.x = 0; p.vx *= -1; }
        if (p.x > WORLD_W) { p.x = WORLD_W; p.vx *= -1; }
        if (p.y < 0) { p.y = 0; p.vy *= -1; }
        if (p.y > WORLD_H) { p.y = WORLD_H; p.vy *= -1; }
      }
      this.level.goals.forEach((goal, gi) => {
        if (this.goalProgress[gi] < goal.count) {
          this.goalProgress[gi] += goal.count / this.level.ticksPerRound;
        }
      });
      // mid-round nova flash for visual testing, once per round near 70% mark
      if (this.tick === Math.floor(this.level.ticksPerRound * 0.7) && this.round % 2 === 0) {
        const body = this.bodies[this.bodies.length - 1];
        this.events.push({
          round: this.round,
          tick: this.tick,
          x: body?.x ?? WORLD_W / 2,
          y: body?.y ?? WORLD_H / 2,
          mass: 40,
          kind: 'supernova',
        });
        this.scoreboard.novae++;
        this.log.push('Supernova!');
      }
      if (this.tick >= this.level.ticksPerRound) {
        this.phase = 'roundEnd';
        this.energy += this.level.incomePerRound;
        for (const el of ELEMENTS) {
          this.scoreboard.elements[el] += this.rand() * 3;
        }
        this.log.push(`Round ${this.round} ended.`);
        return false;
      }
    }
    return true;
  }

  runRound(): void {
    while (this.phase === 'running') this.step(this.level.ticksPerRound);
  }

  help(): string {
    return `Mock game for level ${this.levelId}: place tools during plan, then run the round.`;
  }
}

export const createMockGame: GameFactory = (levelId: number, seed?: number) =>
  new MockGame(levelId, seed);

/**
 * GRAVITY GAME — shared contract between simulation, levels, UI and headless play.
 * Everything renderable or decidable by a player MUST be reachable from GameState.
 * The simulation is deterministic given (levelId, seed, action log).
 * Units: board is WIDTH x HEIGHT world units (16:9, default 160 x 90). 1 tick = 1/30 s game time.
 */

export type Element = 'H' | 'He' | 'C' | 'O' | 'Fe' | 'heavy';
export const ELEMENTS: Element[] = ['H', 'He', 'C', 'O', 'Fe', 'heavy'];

export type BodyKind =
  | 'cloud'        // dense particle cloud, has own gravity, accretes
  | 'planet'       // small compact body, no fusion
  | 'star_ms'      // main sequence star (circle) — fuses H -> He
  | 'star_giant'   // red giant (rounded square) — fuses He -> C/O
  | 'white_dwarf'  // hexagon — inert remnant
  | 'neutron'      // triangle — supernova remnant
  | 'black_hole';  // ring — placed by tool or formed from massive collapse

export interface Vec2 { x: number; y: number }

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  el: Element;
  /** 0 = free, else index into bodies (captured, not simulated individually) */
  bodyId: number;
}

export interface Body {
  id: number;
  kind: BodyKind;
  x: number; y: number;
  vx: number; vy: number;
  mass: number;                    // in particle-mass units
  radius: number;                  // visual/collision radius in world units
  composition: Record<Element, number>; // mass by element
  age: number;                     // ticks since formation in current kind
  /** 0..1 progress toward next lifecycle transition (fusion depletion, collapse) */
  progress: number;
}

/** Player-placed effects. Nodes are static unless noted. */
export type ToolId =
  | 'repulsor'     // point anti-gravity node, medium radius, permanent
  | 'wall'         // short line repulsor (placed as segment: x,y,x2,y2), permanent
  | 'pulse'        // strong radial push for durationSec, then fades
  | 'lens'         // attractor node (focuses particles), permanent, expensive
  | 'black_hole'   // consumes particles, huge gravity; reward tool
  | 'red_matter';  // converts nearby cloud instantly to collapse (skip fusion); reward tool

export interface ToolDef {
  id: ToolId;
  name: string;
  description: string;   // one sentence, player-facing
  cost: number;          // dark energy
  radius: number;        // effect radius in world units
  strength: number;      // signed: negative = repel, positive = attract
  durationSec: number | null;   // game seconds the effect lasts; null = permanent
  unlockLevel: number;   // first level where available in the palette
}

export interface Node {
  id: number;
  tool: ToolId;
  x: number; y: number;
  x2?: number; y2?: number;      // wall endpoint
  /** game time (s) when placed */
  placedAt: number;
  /** game time (s) when a timed node (pulse) expires; null = permanent */
  expiresAt: number | null;
  /** black_hole only: current mass (grows as it swallows) */
  mass?: number;
  /** true if placed from the free reward inventory (refund goes back to inventory) */
  free?: boolean;
}

export type GoalType =
  | 'clouds'        // >= count bodies of kind cloud|planet|star* (any bound mass) right now
  | 'planets'       // >= count planets (includes stars, since planets may have progressed)
  | 'stars'         // >= count stars of any kind (ms|giant|white_dwarf|neutron)
  | 'star_kind'     // >= count of a specific BodyKind (param kind)
  | 'element'       // >= amount of Element produced cumulatively (param el)
  | 'novae'         // >= count supernova events cumulatively
  | 'density';      // max cell density >= value (tutorial only)

export interface Goal {
  type: GoalType;
  count: number;
  kind?: BodyKind;
  el?: Element;
  /** element goals: if set, sum of these elements (e.g. ['C','O']); overrides el */
  els?: Element[];
  /** Countdown: seconds of game time from level start to meet this goal. Met goals latch. */
  deadlineSec: number;
  /** points awarded when met; more if met early (see POINTS in src/sim/params.ts) */
  points: number;
  label: string;   // player-facing, e.g. "Form 1 particle cloud"
}

export interface LevelDef {
  id: number;                 // 1..5 for now
  name: string;
  intro: string;              // 1-3 short sentences shown on the intro card
  seed: number;
  particleCount: number;
  /** element mix of initial particles, weights */
  initialMix: Partial<Record<Element, number>>;
  startingEnergy: number;
  /** dark energy trickles in continuously */
  incomePerSec: number;
  ambientGravity: number;     // baseline pull toward board center, 0..1
  /** strength multiplier of the counter-clockwise gas current around the centre (default 1) */
  swirl?: number;
  tools: ToolId[];            // palette for this level
  goals: Goal[];              // each has its own countdown (deadlineSec)
  /** Free reward tools granted on win (added to inventory for later levels) */
  rewards?: Partial<Record<ToolId, number>>;
  /** procedural levels: the calibration bot's winning line as timed actions */
  solution?: TimedAction[];
}

export interface NovaEvent { t: number; x: number; y: number; mass: number; kind: 'supernova' | 'collapse' }

/** An action scheduled at game time t (seconds). Used by solutions, the calibration bot and replays. */
export interface TimedAction { t: number; action: Action }

export interface Scoreboard {
  cloudsFormed: number;                 // cumulative
  starsByKind: Record<BodyKind, number>; // cumulative formations per kind
  novae: number;                        // cumulative supernova events
  elements: Record<Element, number>;    // cumulative produced (fusion/nova output), not initial stock
  /** POINTS: the player's score. Earned live from creation, spent on hints. Never negative. */
  points: number;
  /** where the points came from (for the end card); spentHints is a positive number subtracted */
  pointsBy: { clouds: number; planets: number; stars: number; novae: number; elements: number; goals: number; spentHints: number };
}

/**
 * Continuous play. 'intro': card shown, sim paused. 'playing': sim runs, player places any time.
 * 'cleared': all goals met; the grid KEEPS RUNNING and points keep accruing until the player moves on.
 * There is no hard loss: a goal whose countdown hits 0 unmet is marked `missed` (costs a star, no bonus)
 * but stays completable. Stars = 3 - missed goals (min 1) once cleared.
 */
export type Phase = 'intro' | 'playing' | 'cleared';

export interface GameState {
  levelId: number;
  level: LevelDef;
  seed: number;
  phase: Phase;
  /** game time in seconds since level start (totalTick / TICKS_PER_SECOND) */
  time: number;
  totalTick: number;
  energy: number;             // dark energy available
  inventory: Partial<Record<ToolId, number>>; // reward tools (free uses)
  particles: Particle[];      // free + captured (captured have bodyId != 0)
  bodies: Body[];
  nodes: Node[];
  /** gravity potential grid, row-major, GRID_W x GRID_H, higher = stronger pull */
  field: Float32Array;
  gridW: number; gridH: number;
  /** smoothed free-gas density per cell (particles/cell), same layout as field */
  density?: Float32Array;
  /** density at which a cloud condenses (compare with density[]) */
  cloudThreshold?: number;
  width: number; height: number;   // world units
  scoreboard: Scoreboard;
  goals: GoalStatus[];
  /** 0 until cleared, then 1..3 */
  stars: number;
  /** most recent hint (UI shows it as a ghost placement until acted on or dismissed) */
  hint: Hint | null;
  events: NovaEvent[];        // recent events (last ~5 s) for VFX
  log: string[];              // last few human-readable events ("Cloud formed", "Star ignited")
}

export type Action =
  | { type: 'place'; tool: ToolId; x: number; y: number; x2?: number; y2?: number }
  | { type: 'remove'; nodeId: number }        // full refund within GRACE_SEC of placing; no refund after
  | { type: 'move'; nodeId: number; x: number; y: number; x2?: number; y2?: number } // free, only within GRACE_SEC of placing
  | { type: 'hint' }                          // costs points (POINTS.hintCost, rising per use); sets state.hint
  | { type: 'start' }                         // intro -> playing
  | { type: 'restart' };

export interface ActionResult { ok: boolean; reason?: string; hint?: Hint }

export interface GoalStatus {
  goal: Goal;
  current: number;
  met: boolean;
  /** game time it was met, if met */
  metAt?: number;
  /** countdown reached 0 before it was met */
  missed: boolean;
  /** seconds left on the countdown (0 once expired; frozen once met) */
  remainingSec: number;
}

/** A suggested placement from the hint engine. */
export interface Hint {
  tool: ToolId;
  x: number; y: number; x2?: number; y2?: number;
  /** one short player-facing sentence: why this helps (e.g. "Dam the current above the cloud to feed it") */
  reason: string;
  /** which goal it targets (index into goals) */
  goalIndex: number;
  /** points paid for it */
  cost: number;
  at: number; // game time issued
}

/** Moves/removals are free (full refund) for this many game seconds after placing. */
export const GRACE_SEC = 5;

/** The headless-playable game. UI and the CLI both drive this interface. */
export interface Game {
  state(): GameState;
  apply(a: Action): ActionResult;
  /** advance n ticks while phase is 'playing' or 'cleared' (UI animates by stepping; pause = don't call). */
  step(n?: number): void;
  /** convenience: advance `seconds` of game time synchronously */
  runFor(seconds: number): void;
  /** Player-facing rule summary for the current level/tools, for tutorials and agents */
  help(): string;
}

export interface GameFactory { (levelId: number, seed?: number): Game }

export const WORLD_W = 160;
export const WORLD_H = 90;
export const GRID_W = 64;
export const GRID_H = 36;
export const TICKS_PER_SECOND = 30;

// ---- v0.2 contract additions: adaptive world size, procedural levels, force sampling ----

/** Options for createGame(levelId, seed?, opts?). */
export interface GameOptions {
  /** reward tools carried over from earlier levels */
  inventory?: Partial<Record<ToolId, number>>;
  /** board size in world units + grid; default DEFAULT_WORLD (160x90, 64x36). See src/sim/worldSize.ts */
  world?: { width: number; height: number; gridW: number; gridH: number };
  /** play this level definition instead of looking up levelId (used for procedural levels) */
  level?: LevelDef;
}

/**
 * Sim-owned (src/sim/force.ts): `forceAt(state, x, y): Vec2` returns the acceleration a free
 * particle at (x,y) feels right now (field gradient incl. bodies + nodes + ambient, plus gas current),
 * in world units per tick^2. UI draws gravity arrows from it.
 *
 * Levels (src/levels/catalog.ts): `HANDCRAFTED_COUNT = 3`; `getLevelDef(n, world)` returns the
 * handcrafted level for n <= 3 and a procedurally generated, calibrated (always winnable) level for n >= 4.
 * `generateLevel(n, world)` in src/levels/procgen.ts is deterministic in (n, world) and may take a few seconds.
 * Worker (src/levels/procgen.worker.ts): postMessage({ n, world }) -> replies { n, key, level: LevelDef }
 * where key = levelCacheKey(n, world) from catalog.ts.
 */

// ---- v0.3 contract: continuous play, countdown goals, points, hints ----
/*
 * POINTS (sim-owned constants in src/sim/params.ts, shown in help()):
 *   cloud formed, planet formed, star by kind (ms < giant < white_dwarf < neutron), supernova,
 *   per unit of element produced (heavier = more), goal met (goal.points x early-finish multiplier).
 * Hints: apply({type:'hint'}) -> costs POINTS.hintCost x (1 + hintsUsed); rejected with a reason if the
 * player can't afford it. The hint engine picks a concrete placement for the most urgent unmet goal
 * (short lookahead on a cloned world or the calibration bot's heuristic) that the player can afford.
 * CLI (scripts/play.ts): actions as JSON lines plus {"type":"advance","seconds":N}, {"type":"state"}, {"type":"help"}.
 */

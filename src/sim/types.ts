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
  | 'pulse'        // one-round strong radial push, then fades
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
  durationRounds: number | null; // null = permanent
  unlockLevel: number;   // first level where available in the palette
}

export interface Node {
  id: number;
  tool: ToolId;
  x: number; y: number;
  x2?: number; y2?: number;      // wall endpoint
  roundsLeft: number | null;     // null = permanent
  placedRound: number;
}

export type GoalType =
  | 'clouds'        // >= count bodies of kind cloud|planet|star* (any bound mass) at round end
  | 'planets'       // >= count planets (includes stars, since planets may have progressed)
  | 'stars'         // >= count stars of any kind (ms|giant|white_dwarf|neutron)
  | 'star_kind'     // >= count of a specific BodyKind (param kind)
  | 'element'       // >= amount of Element produced cumulatively (param el)
  | 'novae'         // >= count supernova events cumulatively
  | 'density';      // max cell density >= value at round end (tutorial only)

export interface Goal {
  type: GoalType;
  count: number;
  kind?: BodyKind;
  el?: Element;
  /** Must be satisfied by END of this round (1-based). Level is lost if not. */
  byRound: number;
  label: string;   // player-facing, e.g. "Form 1 particle cloud"
}

export interface LevelDef {
  id: number;                 // 1..5 for now
  name: string;
  intro: string;              // 1-3 short sentences shown before round 1
  seed: number;
  particleCount: number;
  /** element mix of initial particles, weights */
  initialMix: Partial<Record<Element, number>>;
  rounds: number;             // total rounds
  ticksPerRound: number;      // sim ticks advanced per round (e.g. 600 = 20 s)
  startingEnergy: number;
  incomePerRound: number;
  ambientGravity: number;     // baseline pull toward board center, 0..1
  tools: ToolId[];            // palette for this level
  goals: Goal[];              // all must be met by their byRound
  /** Free reward tools granted on win (added to inventory for later levels) */
  rewards?: Partial<Record<ToolId, number>>;
}

export interface NovaEvent { round: number; tick: number; x: number; y: number; mass: number; kind: 'supernova' | 'collapse' }

export interface Scoreboard {
  cloudsFormed: number;                 // cumulative
  starsByKind: Record<BodyKind, number>; // cumulative formations per kind
  novae: number;                        // cumulative supernova events
  elements: Record<Element, number>;    // cumulative produced (fusion/nova output), not initial stock
  score: number;                        // aggregate
}

export type Phase = 'intro' | 'plan' | 'running' | 'roundEnd' | 'won' | 'lost';

export interface GameState {
  levelId: number;
  level: LevelDef;
  seed: number;
  phase: Phase;
  round: number;              // 1-based current round
  tick: number;               // ticks elapsed in current round
  totalTick: number;
  energy: number;             // dark energy available
  inventory: Partial<Record<ToolId, number>>; // reward tools (free uses)
  particles: Particle[];      // free + captured (captured have bodyId != 0)
  bodies: Body[];
  nodes: Node[];
  /** gravity potential grid, row-major, GRID_W x GRID_H, higher = stronger pull */
  field: Float32Array;
  gridW: number; gridH: number;
  width: number; height: number;   // world units
  scoreboard: Scoreboard;
  goals: { goal: Goal; current: number; met: boolean }[];
  events: NovaEvent[];        // this round's events for VFX
  log: string[];              // last few human-readable events ("Cloud formed", "Star ignited")
}

export type Action =
  | { type: 'place'; tool: ToolId; x: number; y: number; x2?: number; y2?: number }
  | { type: 'remove'; nodeId: number }        // refunds 50% if placed this round
  | { type: 'endRound' }                      // advance sim by ticksPerRound
  | { type: 'restart' };

export interface ActionResult { ok: boolean; reason?: string }

/** The headless-playable game. UI and the CLI both drive this interface. */
export interface Game {
  state(): GameState;
  apply(a: Action): ActionResult;
  /** advance n ticks while phase==='running' (UI animates by stepping); returns true if round still running */
  step(n?: number): boolean;
  /** convenience: run the round to completion synchronously */
  runRound(): void;
  /** Player-facing rule summary for the current level/tools, for tutorials and agents */
  help(): string;
}

export interface GameFactory { (levelId: number, seed?: number): Game }

export const WORLD_W = 160;
export const WORLD_H = 90;
export const GRID_W = 64;
export const GRID_H = 36;
export const TICKS_PER_SECOND = 30;

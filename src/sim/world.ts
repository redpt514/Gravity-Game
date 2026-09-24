import type { Body, GameState } from './types.ts';
import type { Rng } from './rng.ts';

/** Internal mutable simulation container: public GameState + scratch buffers. */
export interface World {
  s: GameState;
  rng: Rng;
  nextBodyId: number;
  nextNodeId: number;
  cell: number;           // world units per grid cell
  ambientBase: Float32Array;
  rippleSin: Float32Array;
  rippleCos: Float32Array;
  rho: Float32Array;      // free-particle density (particles per cell)
  rhoS: Float32Array;     // smoothed density (3x3 avg)
  src: Float32Array;      // gravity source
  grav: Float32Array;     // blurred gravity potential
  pot: Float32Array;      // total potential felt by gas (field - pressure)
  gx: Float32Array; gy: Float32Array;   // gradient of pot (per world unit)
  fgx: Float32Array; fgy: Float32Array; // gradient of field (bodies feel this)
  tmp: Float32Array;
  cellStart: Int32Array;
  cellItems: Int32Array;
  bodyById: Map<number, Body>;
  /** fractional accretion budget carried per body id */
  accreteBudget: Map<number, number>;
  removedParticles: number; // count of particles marked bodyId = -1 this tick
  maxDensity: number;
  /** level mean density (particles per cell) at start; thresholds scale with it */
  meanDensity: number;
}

export function makeWorld(s: GameState, rng: Rng): World {
  const n = s.gridW * s.gridH;
  const f = () => new Float32Array(n);
  return {
    s, rng, nextBodyId: 1, nextNodeId: 1,
    cell: s.width / s.gridW,
    ambientBase: f(), rippleSin: f(), rippleCos: f(), rho: f(), rhoS: f(), src: f(), grav: f(), pot: f(),
    gx: f(), gy: f(), fgx: f(), fgy: f(), tmp: f(),
    cellStart: new Int32Array(n + 1),
    cellItems: new Int32Array(Math.max(1, s.particles.length)),
    bodyById: new Map(),
    accreteBudget: new Map(),
    removedParticles: 0,
    maxDensity: 0,
    meanDensity: s.level.particleCount / n,
  };
}

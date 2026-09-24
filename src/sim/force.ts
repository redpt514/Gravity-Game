import { P } from './params.ts';
import { sampleGrad } from './field.ts';
import type { GameState, Vec2 } from './types.ts';
import { worldOf } from './world.ts';

/**
 * Acceleration felt by a free particle, split into terms so the integrator in particles.ts can add them in
 * a fixed order (bit-for-bit deterministic): g = accel * grad(pot) (field incl. ambient, bodies, nodes, minus
 * pressure), c = gas current, b = soft board-edge spring.
 */
export interface ForceParts { gx: number; gy: number; cx: number; cy: number; bx: number; by: number }

const gr = { x: 0, y: 0 };

/**
 * Drive strength of the gas current. The ellipse's flow speed is `sw` along the top/bottom edges and
 * `sw*b/a` along the sides, so on tall boards (b > a) it is scaled down to keep the fastest edge at `sw`.
 */
export function swirlStrength(s: GameState): number {
  const sw = P.swirl * (s.level.swirl ?? 1);
  return s.height > s.width ? sw * (s.width / s.height) : sw;
}

/** The single implementation of free-particle forces. `pot` is the potential gas feels (World.pot). */
export function particleForce(s: GameState, pot: Float32Array, cell: number, x: number, y: number, o: ForceParts): void {
  const W = s.width, H = s.height, m = P.boundMargin;
  sampleGrad(pot, s.gridW, s.gridH, cell, x, y, gr);
  o.gx = P.accel * gr.x;
  o.gy = P.accel * gr.y;
  // divergence-free elliptical current: v ~ s(u) * (dy/b, -dx*b/a^2), u = (dx/a)^2 + (dy/b)^2
  const a = W / 2, b = H / 2, ia2 = 1 / (a * a), ib2 = 1 / (b * b);
  const sw = swirlStrength(s);
  const u0 = P.swirlFadeStart, u1 = P.swirlFadeEnd;
  const dx = x - a, dy = y - b;
  const u = dx * dx * ia2 + dy * dy * ib2;
  const su = u <= u0 ? sw : u >= u1 ? 0 : sw * (u1 - u) / (u1 - u0);
  o.cx = su * dy / b;
  o.cy = -su * dx * b * ia2;
  o.bx = x < m ? P.boundK * (m - x) : x > W - m ? -P.boundK * (x - (W - m)) : 0;
  o.by = y < m ? P.boundK * (m - y) : y > H - m ? -P.boundK * (y - (H - m)) : 0;
}

const parts: ForceParts = { gx: 0, gy: 0, cx: 0, cy: 0, bx: 0, by: 0 };

/**
 * Acceleration (world units / tick^2) a free particle at (x,y) feels right now: field gradient (ambient,
 * bodies, nodes; lens at its gas fraction; gas pressure) + gas current + edge spring. Same code path as
 * the particle integrator. Cheap: no allocation beyond the returned vector (none if `out` is passed).
 * For states not built by createGame (UI mocks) it falls back to the gradient of `state.field`.
 */
export function forceAt(state: GameState, x: number, y: number, out?: Vec2): Vec2 {
  const w = worldOf(state);
  const pot = w ? w.pot : state.field;
  const cell = w ? w.cell : state.width / state.gridW;
  particleForce(state, pot, cell, x, y, parts);
  const r = out ?? { x: 0, y: 0 };
  r.x = parts.gx + parts.cx + parts.bx;
  r.y = parts.gy + parts.cy + parts.by;
  return r;
}

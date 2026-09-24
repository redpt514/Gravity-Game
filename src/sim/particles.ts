import { P } from './params.ts';
import { sampleGrad } from './field.ts';
import type { Element, LevelDef, Particle } from './types.ts';
import { ELEMENTS } from './types.ts';
import type { Rng } from './rng.ts';
import type { World } from './world.ts';

export function pickElement(mix: Partial<Record<Element, number>>, u: number): Element {
  let total = 0;
  for (const e of ELEMENTS) total += mix[e] ?? 0;
  if (total <= 0) return 'H';
  let acc = 0;
  for (const e of ELEMENTS) {
    acc += (mix[e] ?? 0) / total;
    if (u < acc) return e;
  }
  return 'H';
}

export function initParticles(level: LevelDef, rng: Rng, width: number, height: number): Particle[] {
  const out: Particle[] = [];
  const m = P.boundMargin;
  for (let i = 0; i < level.particleCount; i++) {
    const a = rng.next() * Math.PI * 2;
    const sp = rng.next() * P.initSpeed;
    out.push({
      x: m + rng.next() * (width - 2 * m),
      y: m + rng.next() * (height - 2 * m),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      el: pickElement(level.initialMix, rng.next()),
      bodyId: 0,
    });
  }
  return out;
}

/** Acceleration of the elliptical gas current at (x,y), written into out. Divergence-free. */
export function currentAt(w: World, x: number, y: number, out: { x: number; y: number }): void {
  const s = w.s;
  const a = s.width / 2, b = s.height / 2;
  const dx = x - a, dy = y - b;
  const u = (dx * dx) / (a * a) + (dy * dy) / (b * b);
  const sw = P.swirl * (s.level.swirl ?? 1);
  const u0 = P.swirlFadeStart, u1 = P.swirlFadeEnd;
  const su = u <= u0 ? sw : u >= u1 ? 0 : (sw * (u1 - u)) / (u1 - u0);
  out.x = (su * dy) / b;
  out.y = (-su * dx * b) / (a * a);
}

/** Integrate free particles along -grad(pressure) + grad(field). */
export function stepFreeParticles(w: World): void {
  const s = w.s;
  const gw = s.gridW, gh = s.gridH, cell = w.cell;
  const W = s.width, H = s.height, m = P.boundMargin;
  const damp = P.damping, acc = P.accel, vmax = P.maxSpeed, vmax2 = vmax * vmax;
  const gr = { x: 0, y: 0 };
  // divergence-free elliptical current: v ~ s(u) * (dy/b, -dx*b/a^2), u = (dx/a)^2 + (dy/b)^2
  const a = W / 2, b = H / 2, ia2 = 1 / (a * a), ib2 = 1 / (b * b);
  const sw = P.swirl * (s.level.swirl ?? 1);
  const u0 = P.swirlFadeStart, u1 = P.swirlFadeEnd;
  for (const p of s.particles) {
    if (p.bodyId !== 0) continue;
    sampleGrad(w.pot, gw, gh, cell, p.x, p.y, gr);
    const dx = p.x - a, dy = p.y - b;
    const u = dx * dx * ia2 + dy * dy * ib2;
    const su = u <= u0 ? sw : u >= u1 ? 0 : sw * (u1 - u) / (u1 - u0);
    let vx = p.vx * damp + acc * gr.x + su * dy / b;
    let vy = p.vy * damp + acc * gr.y - su * dx * b * ia2;
    if (p.x < m) vx += P.boundK * (m - p.x); else if (p.x > W - m) vx -= P.boundK * (p.x - (W - m));
    if (p.y < m) vy += P.boundK * (m - p.y); else if (p.y > H - m) vy -= P.boundK * (p.y - (H - m));
    const v2 = vx * vx + vy * vy;
    if (v2 > vmax2) { const f = vmax / Math.sqrt(v2); vx *= f; vy *= f; }
    let x = p.x + vx, y = p.y + vy;
    if (x < 0.1) { x = 0.1; vx = 0; } else if (x > W - 0.1) { x = W - 0.1; vx = 0; }
    if (y < 0.1) { y = 0.1; vy = 0; } else if (y > H - 0.1) { y = H - 0.1; vy = 0; }
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
  }
}

/** Captured particles ride along with their body, kept inside its radius. */
export function stepCapturedParticles(w: World): void {
  for (const p of w.s.particles) {
    if (p.bodyId <= 0) continue;
    const b = w.bodyById.get(p.bodyId);
    if (!b) continue;
    let dx = p.x + b.vx - b.x, dy = p.y + b.vy - b.y;
    const r = b.radius * 0.85;
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r) { const f = r / Math.sqrt(d2); dx *= f; dy *= f; }
    p.x = b.x + dx; p.y = b.y + dy;
    p.vx = b.vx; p.vy = b.vy;
  }
}

/** Counting-sort free particles into grid cells. */
export function buildCellLists(w: World): void {
  const s = w.s;
  const gw = s.gridW, gh = s.gridH, n = gw * gh, cell = w.cell;
  const start = w.cellStart;
  start.fill(0);
  const ps = s.particles;
  if (w.cellItems.length < ps.length) w.cellItems = new Int32Array(ps.length);
  for (let k = 0; k < ps.length; k++) {
    const p = ps[k];
    if (p.bodyId !== 0) continue;
    start[cellOf(p.x, p.y, cell, gw, gh) + 1]++;
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const fill = w.tmp; // reuse as cursor (float ok for ints < 2^24)
  for (let i = 0; i < n; i++) fill[i] = start[i];
  for (let k = 0; k < ps.length; k++) {
    const p = ps[k];
    if (p.bodyId !== 0) continue;
    const c = cellOf(p.x, p.y, cell, gw, gh);
    w.cellItems[fill[c]++] = k;
  }
}

export function cellOf(x: number, y: number, cell: number, gw: number, gh: number): number {
  let i = Math.floor(x / cell), j = Math.floor(y / cell);
  if (i < 0) i = 0; else if (i >= gw) i = gw - 1;
  if (j < 0) j = 0; else if (j >= gh) j = gh - 1;
  return j * gw + i;
}

/** Visit indices of free particles (per last buildCellLists) within radius r of (x,y). */
export function forEachFreeNear(w: World, x: number, y: number, r: number, fn: (k: number, d2: number) => void): void {
  const s = w.s, cell = w.cell, gw = s.gridW, gh = s.gridH;
  const i0 = Math.max(0, Math.floor((x - r) / cell)), i1 = Math.min(gw - 1, Math.floor((x + r) / cell));
  const j0 = Math.max(0, Math.floor((y - r) / cell)), j1 = Math.min(gh - 1, Math.floor((y + r) / cell));
  const r2 = r * r;
  const ps = s.particles;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = j * gw + i;
    for (let q = w.cellStart[c]; q < w.cellStart[c + 1]; q++) {
      const k = w.cellItems[q];
      const p = ps[k];
      if (p.bodyId !== 0) continue;
      const dx = p.x - x, dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) fn(k, d2);
    }
  }
}

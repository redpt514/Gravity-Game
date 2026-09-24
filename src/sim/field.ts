import { P } from './params.ts';
import { TOOL_DEFS } from './tools.ts';
import type { Node } from './types.ts';
import type { World } from './world.ts';

/** Separable box blur (running sums, clamped edges), `passes` times. src may equal dst. */
export function boxBlur(src: Float32Array, dst: Float32Array, tmp: Float32Array, w: number, h: number, r: number, passes: number): void {
  if (src !== dst) dst.set(src);
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    // horizontal: dst -> tmp
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += dst[row + (k < 0 ? 0 : k >= w ? w - 1 : k)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc * inv;
        const add = x + r + 1, rem = x - r;
        acc += dst[row + (add >= w ? w - 1 : add)] - dst[row + (rem < 0 ? 0 : rem)];
      }
    }
    // vertical: tmp -> dst
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[(k < 0 ? 0 : k >= h ? h - 1 : k) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = acc * inv;
        const add = y + r + 1, rem = y - r;
        acc += tmp[(add >= h ? h - 1 : add) * w + x] - tmp[(rem < 0 ? 0 : rem) * w + x];
      }
    }
  }
}

/** Bilinear splat of `m` at world (x,y) into grid g. */
export function splat(g: Float32Array, w: number, h: number, cell: number, x: number, y: number, m: number): void {
  let fx = x / cell - 0.5, fy = y / cell - 0.5;
  if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0; else if (fy > h - 1) fy = h - 1;
  let ix = Math.floor(fx), iy = Math.floor(fy);
  if (ix >= w - 1) ix = w - 2;
  if (iy >= h - 1) iy = h - 2;
  const tx = fx - ix, ty = fy - iy;
  const i = iy * w + ix;
  g[i] += m * (1 - tx) * (1 - ty);
  g[i + 1] += m * tx * (1 - ty);
  g[i + w] += m * (1 - tx) * ty;
  g[i + w + 1] += m * tx * ty;
}

/** Gradient (d/dx, d/dy per world unit) of the bilinear interpolant of g at (x,y). Writes into out. */
export function sampleGrad(g: Float32Array, w: number, h: number, cell: number, x: number, y: number, out: { x: number; y: number }): void {
  let fx = x / cell - 0.5, fy = y / cell - 0.5;
  if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0; else if (fy > h - 1) fy = h - 1;
  let ix = Math.floor(fx), iy = Math.floor(fy);
  if (ix >= w - 1) ix = w - 2;
  if (iy >= h - 1) iy = h - 2;
  const tx = fx - ix, ty = fy - iy;
  const i = iy * w + ix;
  const a = g[i], b = g[i + 1], c = g[i + w], d = g[i + w + 1];
  out.x = ((b - a) * (1 - ty) + (d - c) * ty) / cell;
  out.y = ((c - a) * (1 - tx) + (d - b) * tx) / cell;
}

/** Bilinear sample of grid g at world (x,y). */
export function sample(g: Float32Array, w: number, h: number, cell: number, x: number, y: number): number {
  let fx = x / cell - 0.5, fy = y / cell - 0.5;
  if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0; else if (fy > h - 1) fy = h - 1;
  let ix = Math.floor(fx), iy = Math.floor(fy);
  if (ix >= w - 1) ix = w - 2;
  if (iy >= h - 1) iy = h - 2;
  const tx = fx - ix, ty = fy - iy;
  const i = iy * w + ix;
  return (g[i] * (1 - tx) + g[i + 1] * tx) * (1 - ty) + (g[i + w] * (1 - tx) + g[i + w + 1] * tx) * ty;
}

export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

/** Effective strength of a node right now (pulse decays, black hole grows). */
export function nodeStrength(w: World, n: Node): number {
  const def = TOOL_DEFS[n.tool];
  if (n.tool === 'pulse') {
    const s = w.s;
    if (s.phase !== 'running' || n.placedRound !== s.round) return 0;
    const f = 1 - s.tick / s.level.ticksPerRound;
    return def.strength * Math.max(0, f);
  }
  if (n.tool === 'black_hole') {
    const m = (n as Node & { mass?: number }).mass ?? P.blackHoleStartMass;
    return def.strength * Math.sqrt(m / P.blackHoleStartMass);
  }
  return def.strength;
}

/** Potential contribution of node n at world (x,y). */
export function nodeKernel(n: Node, strength: number, x: number, y: number): number {
  const r = TOOL_DEFS[n.tool].radius;
  let d: number;
  if (n.tool === 'wall' && n.x2 !== undefined && n.y2 !== undefined) d = segDist(x, y, n.x, n.y, n.x2, n.y2);
  else { const dx = x - n.x, dy = y - n.y; d = Math.sqrt(dx * dx + dy * dy); }
  if (d >= r) return 0;
  const q = 1 - d / r;
  if (n.tool === 'pulse') return strength * q;
  return strength * q * q;
}

export function initAmbient(w: World): void {
  const { gridW: gw, gridH: gh, width, height } = w.s;
  const cx = width / 2, cy = height / 2;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = (i + 0.5) * w.cell, y = (j + 0.5) * w.cell;
    const nx = (x - cx) / (width / 2), ny = (y - cy) / (height / 2);
    w.ambientBase[j * gw + i] = 1 - 0.5 * (nx * nx + ny * ny);
    const A = ((2 * Math.PI) / P.rippleWaveLen) * (x * 0.8 + y * 0.6);
    w.rippleSin[j * gw + i] = Math.sin(A);
    w.rippleCos[j * gw + i] = Math.cos(A);
  }
}

/**
 * Rebuild density, gravity and the public `field` grid, plus gradients.
 * field = ambient + G*blur(max(0, rho - threshold) + bodies) + node kernels.
 */
export function computeField(w: World): void {
  const s = w.s;
  const gw = s.gridW, gh = s.gridH, n = gw * gh, cell = w.cell;
  const { rho, rhoS, src, grav, tmp, pot, gx, gy, fgx, fgy } = w;
  const field = s.field;
  rho.fill(0);
  src.fill(0);
  const ps = s.particles;
  for (let k = 0; k < ps.length; k++) {
    const p = ps[k];
    if (p.bodyId === 0) splat(rho, gw, gh, cell, p.x, p.y, 1);
  }
  // bodies occupy their area at the background density so they are not pressure sinks
  for (const b of s.bodies) {
    const area = (Math.PI * b.radius * b.radius) / (cell * cell);
    splat(rho, gw, gh, cell, b.x, b.y, Math.min(b.mass, area * (P.pressureRef > 0 ? P.pressureRef : w.meanDensity) * P.bodyPressureFill));
  }
  boxBlur(rho, rhoS, tmp, gw, gh, 1, P.densityBlurPasses);
  let maxD = 0;
  const gth = P.gravThreshold * w.meanDensity;
  const gcap = Math.max(0, (P.cloudDensity - P.gravThreshold) * w.meanDensity);
  for (let i = 0; i < n; i++) {
    const d = rhoS[i];
    if (d > maxD) maxD = d;
    const e = d - gth;
    src[i] = e > 0 ? (e < gcap ? e : gcap) : 0;
  }
  w.maxDensity = maxD;
  for (const b of s.bodies) splat(src, gw, gh, cell, b.x, b.y, b.mass * P.bodyGravMul);
  boxBlur(src, grav, tmp, gw, gh, P.gravBlurR, P.gravBlurPasses);

  const ph = (2 * Math.PI * s.totalTick) / P.ambientPulsePeriod;
  const amb = s.level.ambientGravity * P.ambientScale * (1 + P.ambientPulseAmp * Math.sin(ph));
  // ripple = rip * sin(A - ph/2) with A precomputed per cell
  const rip = s.level.ambientGravity * P.rippleAmp;
  const rc = rip * Math.cos(ph * 0.5), rs = rip * Math.sin(ph * 0.5);
  const G = P.gravG, base = w.ambientBase, sa = w.rippleSin, ca = w.rippleCos;
  for (let k = 0; k < n; k++) field[k] = amb * base[k] + rc * sa[k] - rs * ca[k] + G * grav[k];

  // node kernels, stamped over their bounding boxes
  for (const nd of s.nodes) {
    const str = nodeStrength(w, nd);
    if (str === 0) continue;
    const r = TOOL_DEFS[nd.tool].radius;
    const x0 = Math.min(nd.x, nd.x2 ?? nd.x) - r, x1 = Math.max(nd.x, nd.x2 ?? nd.x) + r;
    const y0 = Math.min(nd.y, nd.y2 ?? nd.y) - r, y1 = Math.max(nd.y, nd.y2 ?? nd.y) + r;
    const i0 = Math.max(0, Math.floor(x0 / cell)), i1 = Math.min(gw - 1, Math.floor(x1 / cell));
    const j0 = Math.max(0, Math.floor(y0 / cell)), j1 = Math.min(gh - 1, Math.floor(y1 / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      field[j * gw + i] += nodeKernel(nd, str, (i + 0.5) * cell, (j + 0.5) * cell);
    }
  }

  const ref = P.pressureRef > 0 ? P.pressureRef : w.meanDensity, kh = P.pressureK, kl = P.pressureKLow;
  for (let i = 0; i < n; i++) {
    const e = rhoS[i] - ref;
    pot[i] = field[i] - (e > 0 ? kh * e : kl * e);
  }
  gradient(pot, gx, gy, gw, gh, cell);
  gradient(field, fgx, fgy, gw, gh, cell);
}

function gradient(g: Float32Array, gx: Float32Array, gy: Float32Array, w: number, h: number, cell: number): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    const l = i > 0 ? k - 1 : k, r = i < w - 1 ? k + 1 : k;
    const u = j > 0 ? k - w : k, d = j < h - 1 ? k + w : k;
    gx[k] = (g[r] - g[l]) / (((r - l) || 1) * cell);
    gy[k] = (g[d] - g[u]) / ((((d - u) / w) || 1) * cell);
  }
}

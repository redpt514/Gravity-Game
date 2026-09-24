import { P } from './params.ts';
import { sample } from './field.ts';
import { currentAt, forEachFreeNear } from './particles.ts';
import { TOOL_DEFS } from './tools.ts';
import type { Body, BodyKind, Element, Node } from './types.ts';
import { ELEMENTS } from './types.ts';
import type { World } from './world.ts';

export const KIND_LABEL: Record<BodyKind, string> = {
  cloud: 'Cloud', planet: 'Planet', star_ms: 'Star', star_giant: 'Red giant',
  white_dwarf: 'White dwarf', neutron: 'Neutron star', black_hole: 'Black hole',
};

export function emptyComposition(): Record<Element, number> {
  return { H: 0, He: 0, C: 0, O: 0, Fe: 0, heavy: 0 };
}

export function radiusFor(kind: BodyKind, m: number): number {
  const [a, b] = P.bodyRadius[kind];
  return a + b * Math.sqrt(Math.max(0, m));
}

export function log(w: World, msg: string): void {
  const s = w.s;
  s.log.push(`R${s.round} t${s.tick}: ${msg}`);
  if (s.log.length > P.logLines) s.log.splice(0, s.log.length - P.logLines);
}

function fmt(b: Body): string {
  return `${KIND_LABEL[b.kind]} #${b.id} (m=${Math.round(b.mass)}) at ${Math.round(b.x)},${Math.round(b.y)}`;
}

export function setKind(w: World, b: Body, kind: BodyKind, quiet = false): void {
  if (b.kind === kind) return;
  b.kind = kind;
  b.age = 0;
  b.progress = 0;
  b.radius = radiusFor(kind, b.mass);
  w.s.scoreboard.starsByKind[kind]++;
  if (!quiet) {
    const verb: Record<BodyKind, string> = {
      cloud: 'formed', planet: 'condensed', star_ms: 'ignited', star_giant: 'swelled',
      white_dwarf: 'remains', neutron: 'remains', black_hole: 'collapsed',
    };
    log(w, `${fmt(b)} ${verb[kind]}`);
  }
}

function newBody(w: World, kind: BodyKind, x: number, y: number): Body {
  const b: Body = {
    id: w.nextBodyId++, kind, x, y, vx: 0, vy: 0, mass: 0,
    radius: radiusFor(kind, 0), composition: emptyComposition(), age: 0, progress: 0,
  };
  w.s.bodies.push(b);
  w.bodyById.set(b.id, b);
  w.s.scoreboard.starsByKind[kind]++;
  return b;
}

function capture(w: World, b: Body, k: number): void {
  const p = w.s.particles[k];
  p.bodyId = b.id;
  const m = b.mass;
  b.vx = (b.vx * m + p.vx * 0.2) / (m + 1);
  b.vy = (b.vy * m + p.vy * 0.2) / (m + 1);
  b.mass = m + 1;
  b.composition[p.el] += 1;
}

function removeParticlesOf(w: World, bodyId: number): void {
  for (const p of w.s.particles) if (p.bodyId === bodyId) { p.bodyId = -1; w.removedParticles++; }
}

function nodeMass(n: Node): number { return n.mass ?? P.blackHoleStartMass; }

/** Special node effects: black holes swallow, red matter collapses clouds. */
export function nodeEffects(w: World): void {
  const s = w.s;
  let spent: Set<number> | null = null;
  for (const n of s.nodes) {
    if (n.tool === 'black_hole') {
      const cr = TOOL_DEFS.black_hole.radius * P.blackHoleConsumeFrac;
      let eaten = 0;
      forEachFreeNear(w, n.x, n.y, cr, (k) => {
        s.particles[k].bodyId = -1; w.removedParticles++; eaten++;
      });
      n.mass = nodeMass(n) + eaten;
      for (let i = s.bodies.length - 1; i >= 0; i--) {
        const b = s.bodies[i];
        const dx = b.x - n.x, dy = b.y - n.y;
        const lim = cr + b.radius * 0.5;
        if (dx * dx + dy * dy < lim * lim) {
          n.mass = nodeMass(n) + b.mass;
          log(w, `Black hole swallowed ${fmt(b)}`);
          removeParticlesOf(w, b.id);
          s.bodies.splice(i, 1);
          w.bodyById.delete(b.id);
        }
      }
    } else if (n.tool === 'red_matter') {
      for (const b of s.bodies) {
        if (b.kind !== 'cloud' && b.kind !== 'planet') continue;
        const dx = b.x - n.x, dy = b.y - n.y;
        const lim = TOOL_DEFS.red_matter.radius + b.radius;
        if (dx * dx + dy * dy < lim * lim) {
          log(w, `Red matter collapsed ${fmt(b)}`);
          setKind(w, b, 'star_ms');
          (spent ??= new Set()).add(n.id);
          break;
        }
      }
    }
  }
  if (spent) s.nodes = s.nodes.filter((n) => !spent!.has(n.id));
}

export function moveBodies(w: World): void {
  const s = w.s;
  const gw = s.gridW, gh = s.gridH, cell = w.cell;
  const cur = { x: 0, y: 0 };
  for (const b of s.bodies) {
    const mob = b.kind === 'black_hole' ? P.bodyMobility * 0.3 : P.bodyMobility;
    const drift = b.kind === 'black_hole' ? 0 : P.bodyDrift;
    currentAt(w, b.x, b.y, cur);
    let vx = b.vx * P.bodyDamping + mob * sample(w.fgx, gw, gh, cell, b.x, b.y) + drift * cur.x;
    let vy = b.vy * P.bodyDamping + mob * sample(w.fgy, gw, gh, cell, b.x, b.y) + drift * cur.y;
    const v2 = vx * vx + vy * vy;
    if (v2 > P.bodyMaxSpeed * P.bodyMaxSpeed) { const f = P.bodyMaxSpeed / Math.sqrt(v2); vx *= f; vy *= f; }
    let x = b.x + vx, y = b.y + vy;
    const r = b.radius;
    if (x < r) { x = r; vx = 0; } else if (x > s.width - r) { x = s.width - r; vx = 0; }
    if (y < r) { y = r; vy = 0; } else if (y > s.height - r) { y = s.height - r; vy = 0; }
    b.x = x; b.y = y; b.vx = vx; b.vy = vy;
    b.age++;
  }
}

/** Bodies capture nearby free gas, nearest first, limited by a mass-dependent rate. */
export function accrete(w: World): void {
  const cand: number[] = [];
  const dist: number[] = [];
  const s = w.s, th = P.cloudDensity * w.meanDensity;
  for (const b of s.bodies) {
    const bh = b.kind === 'black_hole';
    // well-fed bodies (sitting in dense gas) grow faster
    let feed = sample(w.rhoS, s.gridW, s.gridH, w.cell, b.x, b.y) / th;
    feed = feed < P.accreteFeedMin ? P.accreteFeedMin : feed > P.accreteFeedMax ? P.accreteFeedMax : feed;
    const rate = (P.accreteBase + P.accreteMassMul * b.mass) * feed * (bh ? 4 : 1);
    let budget = (w.accreteBudget.get(b.id) ?? 0) + rate;
    const R = b.radius * P.accreteMul + P.accreteAdd * (bh ? 3 : 1);
    if (budget >= 1) {
      cand.length = 0; dist.length = 0;
      forEachFreeNear(w, b.x, b.y, R, (k, d2) => { cand.push(k); dist.push(d2); });
      if (cand.length > budget) {
        const idx = cand.map((_, i) => i).sort((i, j) => dist[i] - dist[j] || cand[i] - cand[j]);
        const n = Math.floor(budget);
        for (let q = 0; q < n; q++) capture(w, b, cand[idx[q]]);
        budget -= n;
      } else {
        for (const k of cand) capture(w, b, k);
        budget -= cand.length;
      }
    }
    w.accreteBudget.set(b.id, Math.min(budget, P.accreteMaxBudget));
    if (b.kind === 'cloud' || b.kind === 'star_giant' || b.kind === 'black_hole') b.radius = radiusFor(b.kind, b.mass);
  }
}

/** Condense new clouds where smoothed density exceeds the threshold. */
export function formClouds(w: World): void {
  const s = w.s;
  const gw = s.gridW, gh = s.gridH, cell = w.cell, rhoS = w.rhoS;
  const cands: number[] = [];
  const th = P.cloudDensity * w.meanDensity;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    const d = rhoS[k];
    if (d < th) continue;
    let isMax = true;
    for (let dj = -1; dj <= 1 && isMax; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
      const o = rhoS[jj * gw + ii];
      if (o > d || (o === d && jj * gw + ii < k)) { isMax = false; break; }
    }
    if (isMax) cands.push(k);
  }
  cands.sort((a, b) => rhoS[b] - rhoS[a] || a - b);
  let made = 0;
  for (const k of cands) {
    if (made >= P.maxNewCloudsPerCheck) break;
    const cx = ((k % gw) + 0.5) * cell, cy = (Math.floor(k / gw) + 0.5) * cell;
    let blocked = false;
    for (const b of s.bodies) {
      const dx = b.x - cx, dy = b.y - cy, lim = P.minBodySpacing + b.radius;
      if (dx * dx + dy * dy < lim * lim) { blocked = true; break; }
    }
    if (blocked) continue;
    const got: number[] = [];
    forEachFreeNear(w, cx, cy, P.cloudCaptureR, (q) => { got.push(q); });
    if (got.length < P.cloudMinParticles) continue;
    let sx = 0, sy = 0;
    for (const q of got) { sx += s.particles[q].x; sy += s.particles[q].y; }
    const b = newBody(w, 'cloud', sx / got.length, sy / got.length);
    for (const q of got) capture(w, b, q);
    b.radius = radiusFor('cloud', b.mass);
    s.scoreboard.cloudsFormed++;
    log(w, `${fmt(b)} formed`);
    made++;
  }
}

const STAGE: Record<BodyKind, number> = {
  cloud: 0, planet: 1, star_ms: 2, star_giant: 3, white_dwarf: 2, neutron: 2, black_hole: 5,
};

export function mergeBodies(w: World): void {
  const s = w.s;
  const bs = s.bodies;
  let removed: Set<number> | null = null;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    if (removed?.has(a.id)) continue;
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j];
      if (removed?.has(b.id)) continue;
      const dx = b.x - a.x, dy = b.y - a.y, lim = (a.radius + b.radius) * P.mergeFactor;
      if (dx * dx + dy * dy >= lim * lim) continue;
      const [big, small] = a.mass >= b.mass ? [a, b] : [b, a];
      const m = big.mass + small.mass;
      big.x = (big.x * big.mass + small.x * small.mass) / m;
      big.y = (big.y * big.mass + small.y * small.mass) / m;
      big.vx = (big.vx * big.mass + small.vx * small.mass) / m;
      big.vy = (big.vy * big.mass + small.vy * small.mass) / m;
      for (const e of ELEMENTS) big.composition[e] += small.composition[e];
      big.mass = m;
      if (small.kind === 'black_hole' || (STAGE[small.kind] > STAGE[big.kind] && small.kind !== 'white_dwarf' && small.kind !== 'neutron')) {
        setKind(w, big, small.kind, true);
      }
      big.radius = radiusFor(big.kind, big.mass);
      for (const p of s.particles) if (p.bodyId === small.id) p.bodyId = big.id;
      (removed ??= new Set()).add(small.id);
      w.bodyById.delete(small.id);
      log(w, `${KIND_LABEL[small.kind]} #${small.id} merged into ${fmt(big)}`);
      if (small === a) break;
    }
  }
  if (removed) s.bodies = s.bodies.filter((b) => !removed!.has(b.id));
}

/** Largest-remainder allocation of n items proportionally to weights. */
function allocate(weights: Record<Element, number>, n: number): Record<Element, number> {
  const out = emptyComposition();
  let tot = 0;
  for (const e of ELEMENTS) tot += Math.max(0, weights[e]);
  if (tot <= 0 || n <= 0) { out.H = Math.max(0, n); return out; }
  let used = 0;
  const rem: [Element, number][] = [];
  for (const e of ELEMENTS) {
    const x = (Math.max(0, weights[e]) / tot) * n;
    out[e] = Math.floor(x); used += out[e];
    rem.push([e, x - out[e]]);
  }
  rem.sort((a, b) => b[1] - a[1]);
  for (let i = 0; used < n; i++, used++) out[rem[i % rem.length][0]]++;
  return out;
}

function supernova(w: World, b: Body): void {
  const s = w.s;
  const eject = Math.round(b.mass * P.novaEjectFrac);
  const nFe = Math.round(eject * P.novaFeFrac), nHeavy = Math.round(eject * P.novaHeavyFrac);
  const rest = allocate(b.composition, eject - nFe - nHeavy);
  const ej = { ...rest, Fe: rest.Fe + nFe, heavy: rest.heavy + nHeavy };
  s.scoreboard.elements.Fe += nFe;
  s.scoreboard.elements.heavy += nHeavy;
  s.scoreboard.novae++;
  s.events.push({ round: s.round, tick: s.tick, x: b.x, y: b.y, mass: b.mass, kind: 'supernova' });
  log(w, `SUPERNOVA${b.kind === 'white_dwarf' ? ' (type Ia)' : ''}! ${fmt(b)} ejected ${eject} particles (Fe ${nFe}, heavy ${nHeavy})`);
  // pick ejected particles and assign their elements
  const order: Element[] = [];
  for (const e of ELEMENTS) for (let i = 0; i < ej[e]; i++) order.push(e);
  let q = 0;
  const rr = radiusFor('star_giant', b.mass) + 1.5;
  for (const p of s.particles) {
    if (q >= eject) break;
    if (p.bodyId !== b.id) continue;
    let dx = p.x - b.x, dy = p.y - b.y;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-3) { const a = w.rng.next() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
    dx /= d; dy /= d;
    const sp = P.novaSpeed * (0.6 + 0.8 * w.rng.next());
    p.bodyId = 0;
    p.el = order[q++];
    p.x = Math.min(s.width - 0.2, Math.max(0.2, b.x + dx * rr));
    p.y = Math.min(s.height - 0.2, Math.max(0.2, b.y + dy * rr));
    p.vx = dx * sp; p.vy = dy * sp;
  }
  // remnant keeps the rest, composition scaled down (ejected elements removed proportionally)
  const keep = b.mass - q;
  for (const e of ELEMENTS) b.composition[e] = Math.max(0, b.composition[e] - rest[e]);
  let ct = 0; for (const e of ELEMENTS) ct += b.composition[e];
  if (ct > 0) for (const e of ELEMENTS) b.composition[e] *= keep / ct;
  b.mass = keep;
  setKind(w, b, 'neutron');
}

export function lifecycle(w: World): void {
  const s = w.s;
  const sb = s.scoreboard;
  for (const b of [...s.bodies]) {
    const m = b.mass;
    if (m <= 0) continue;
    if (m >= P.collapseMass && b.kind !== 'black_hole') {
      s.events.push({ round: s.round, tick: s.tick, x: b.x, y: b.y, mass: m, kind: 'collapse' });
      setKind(w, b, 'black_hole');
      continue;
    }
    switch (b.kind) {
      case 'cloud':
        if (m >= P.starMass) setKind(w, b, 'star_ms');
        else if (m >= P.planetMass) setKind(w, b, 'planet');
        else b.progress = m / P.planetMass;
        break;
      case 'planet':
        if (m >= P.starMass) setKind(w, b, 'star_ms');
        else b.progress = (m - P.planetMass) / (P.starMass - P.planetMass);
        break;
      case 'star_ms': {
        const c = b.composition;
        const d = Math.min(c.H, P.fusionK * m * m);
        c.H -= d; c.He += d; sb.elements.He += d;
        const hf = c.H / m;
        b.progress = Math.min(1, Math.max(0, (1 - hf) / (1 - P.giantHFrac)));
        if (hf < P.giantHFrac) setKind(w, b, 'star_giant');
        break;
      }
      case 'star_giant': {
        const c = b.composition;
        const d = Math.min(c.He, P.fusionK * P.giantFusionMul * m * m);
        c.He -= d; c.C += d / 2; c.O += d / 2;
        sb.elements.C += d / 2; sb.elements.O += d / 2;
        const hef = c.He / m;
        b.progress = Math.min(1, Math.max(0, (1 - hef) / (1 - P.giantEndHeFrac)));
        if (hef < P.giantEndHeFrac) {
          if (m >= P.novaMass) supernova(w, b);
          else setKind(w, b, 'white_dwarf');
        }
        break;
      }
      case 'white_dwarf':
        // a white dwarf fed past its limit detonates (type Ia)
        b.progress = Math.min(1, m / P.wdNovaMass);
        if (m >= P.wdNovaMass) supernova(w, b);
        break;
      default:
        b.progress = 0;
    }
  }
}

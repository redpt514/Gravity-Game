/** Canvas2D layer drawn above the WebGL nebula: particles, bodies, nodes, VFX. */
import type { Body, BodyKind, GameState, Node as SimNode, ToolId } from '../sim/types';
import { computeLetterboxIn, worldToScreen, type Letterbox, type Rect } from './layout';
import { ELEMENT_COLOR, TOOL_COLOR, TOOL_DEFS } from './toolDefs';
import { P } from '../sim/params';
import { forceAt } from '../sim/force';

/** Live placement preview drawn by input.ts while the player is dragging a tool into place. */
export type Preview =
  | { kind: 'point'; tool: ToolId; x: number; y: number; radius: number; valid: boolean }
  | { kind: 'wall'; x1: number; y1: number; x2: number; y2: number; valid: boolean }
  | null;

export interface SceneRenderer {
  /** `boardRect`: the screen area (px) not covered by HUD chrome; the world is letterboxed into it. */
  render(state: GameState, timeSec: number, preview: Preview | undefined, boardRect: Rect): void;
  resize(cssW: number, cssH: number, dpr: number): void;
  lastLetterbox(): Letterbox;
}

const NOVA_FLASH_TICKS = 60; // ~2s at 30 ticks/s

function drawSoftCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(0.5, color.replace(/[\d.]+\)$/, '0.35)'));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawBody(ctx: CanvasRenderingContext2D, b: Body, x: number, y: number, r: number) {
  const rr = Math.max(2.5, r);
  switch (b.kind as BodyKind) {
    case 'cloud': {
      drawSoftCircle(ctx, x, y, rr * 2.4, 'rgba(180,190,255,0.55)');
      break;
    }
    case 'planet': {
      ctx.fillStyle = '#8fb3ff';
      ctx.beginPath();
      ctx.arc(x, y, rr * 0.7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'star_ms': {
      drawSoftCircle(ctx, x, y, rr * 2.2, 'rgba(255,236,170,0.9)');
      ctx.fillStyle = '#fff7dd';
      ctx.beginPath();
      ctx.arc(x, y, rr * 0.9, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'star_giant': {
      drawSoftCircle(ctx, x, y, rr * 2.6, 'rgba(255,140,90,0.7)');
      const s = rr * 1.5;
      const radius = Math.min(6, s * 0.3);
      ctx.fillStyle = '#ff7a45';
      roundRect(ctx, x - s / 2, y - s / 2, s, s, radius);
      ctx.fill();
      break;
    }
    case 'white_dwarf': {
      ctx.fillStyle = '#eaf6ff';
      drawSoftCircle(ctx, x, y, rr * 1.6, 'rgba(220,245,255,0.6)');
      hexPath(ctx, x, y, rr * 0.8);
      ctx.fill();
      break;
    }
    case 'neutron': {
      ctx.fillStyle = '#e6d7ff';
      drawSoftCircle(ctx, x, y, rr * 1.4, 'rgba(220,200,255,0.6)');
      ctx.beginPath();
      const s = rr * 0.9;
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.87, y + s * 0.5);
      ctx.lineTo(x - s * 0.87, y + s * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'black_hole': {
      const outer = rr * 1.6;
      const g = ctx.createRadialGradient(x, y, outer * 0.4, x, y, outer);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,1)');
      g.addColorStop(0.7, 'rgba(180,140,255,0.85)');
      g.addColorStop(1, 'rgba(180,140,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, outer, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** Next lifecycle mass threshold (for the "62/120" style label), or null when the body's
 * progress ring tracks something other than a simple mass target (fusion depletion etc). */
function nextThreshold(kind: BodyKind): number | null {
  switch (kind) {
    case 'cloud': return P.planetMass;
    case 'planet': return P.starMass;
    case 'white_dwarf': return P.wdNovaMass;
    default: return null;
  }
}

/** Mass label + a progress ring toward the body's next lifecycle threshold (body.progress,
 * computed by the sim in src/sim/bodies.ts: mass fraction for cloud/planet/white_dwarf,
 * fuel depletion fraction for star_ms/star_giant). */
function drawBodyBadge(ctx: CanvasRenderingContext2D, b: Body, x: number, y: number, r: number) {
  const ringR = Math.max(6, r + 5);
  if (b.progress > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,236,170,0.95)';
    ctx.beginPath();
    ctx.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, b.progress));
    ctx.stroke();
    ctx.restore();
  }
  const th = nextThreshold(b.kind);
  const label = th != null ? `${Math.round(b.mass)}/${th}` : `${Math.round(b.mass)}`;
  ctx.save();
  ctx.font = '10px -apple-system,BlinkMacSystemFont,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const ty = y + ringR + 3;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(label, x, ty);
  ctx.fillStyle = 'rgba(238,241,251,0.92)';
  ctx.fillText(label, x, ty);
  ctx.restore();
}

interface ArrowSample { x: number; y: number; ang: number; len: number; alpha: number }

/** Gravity-field arrows sampled from forceAt (src/sim/force.ts): the same acceleration a free
 * particle feels right now (field gradient incl. bodies + nodes + ambient, plus the gas current),
 * so they bend into stars/clouds/black holes and away from repulsors/walls. Sampled on a grid of
 * ~1 arrow per ARROW_SPACING_WORLD world units; length/opacity scale with log(magnitude) since
 * raw accelerations span several orders of magnitude near a strong well vs open space. */
const ARROW_SPACING_WORLD = 7;
const ARROW_MAG_SCALE = 200;

function sampleArrows(state: GameState): ArrowSample[] {
  const cols = Math.max(4, Math.round(state.width / ARROW_SPACING_WORLD));
  const rows = Math.max(3, Math.round(state.height / ARROW_SPACING_WORLD));
  const out: ArrowSample[] = [];
  const v = { x: 0, y: 0 };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const wx = ((i + 0.5) / cols) * state.width;
      const wy = ((j + 0.5) / rows) * state.height;
      forceAt(state, wx, wy, v);
      const mag = Math.hypot(v.x, v.y);
      if (mag < 1e-7) continue;
      const norm = Math.log(1 + mag * ARROW_MAG_SCALE);
      out.push({
        x: wx,
        y: wy,
        ang: Math.atan2(v.y, v.x),
        len: 3 + Math.min(9, norm * 3.2),
        alpha: Math.min(0.42, 0.08 + norm * 0.12),
      });
    }
  }
  return out;
}

function drawGravityArrows(ctx: CanvasRenderingContext2D, arrows: ArrowSample[], lb: Letterbox) {
  ctx.save();
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (const a of arrows) {
    const p0 = worldToScreen(a.x, a.y, lb);
    const p1 = worldToScreen(a.x + Math.cos(a.ang) * a.len, a.y + Math.sin(a.ang) * a.len, lb);
    const perp = a.ang + Math.PI / 2;
    const midx = (p0.x + p1.x) / 2 + Math.cos(perp) * 3;
    const midy = (p0.y + p1.y) / 2 + Math.sin(perp) * 3;
    ctx.strokeStyle = `rgba(150,200,255,${a.alpha})`;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo(midx, midy, p1.x, p1.y);
    ctx.stroke();
    const ha = a.ang + 2.6, hb = a.ang - 2.6;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p1.x + Math.cos(ha) * 3, p1.y + Math.sin(ha) * 3);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p1.x + Math.cos(hb) * 3, p1.y + Math.sin(hb) * 3);
    ctx.stroke();
  }
  ctx.restore();
}

/** Faint shading of cells at/above the cloud-condensation density threshold ("marching squares
 * light": shade the cells, no isoline extraction). Uses state.density/state.cloudThreshold,
 * which the sim publishes on GameState (src/sim/game.ts), when present. */
function drawDensityContour(ctx: CanvasRenderingContext2D, state: GameState, lb: Letterbox) {
  if (!state.density || !state.cloudThreshold) return;
  const gw = state.gridW, gh = state.gridH;
  const cw = state.width / gw, ch = state.height / gh;
  const th = state.cloudThreshold;
  ctx.save();
  ctx.fillStyle = 'rgba(255,207,92,0.10)';
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      if (state.density[j * gw + i] < th) continue;
      const p0 = worldToScreen(i * cw, j * ch, lb);
      const p1 = worldToScreen((i + 1) * cw, (j + 1) * ch, lb);
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    }
  }
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  n: SimNode,
  lb: Letterbox,
  timeSec: number,
) {
  const def = TOOL_DEFS[n.tool];
  const color = TOOL_COLOR[n.tool];
  const p = worldToScreen(n.x, n.y, lb);
  const r = def.radius * lb.scale;

  if (n.tool === 'wall' && n.x2 !== undefined && n.y2 !== undefined) {
    const p2 = worldToScreen(n.x2, n.y2, lb);
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, def.radius * 0.3 * lb.scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.save();
  let alpha = 0.85;
  if (n.tool === 'pulse') {
    // fading fill instead of dashed ring
    const life = n.roundsLeft ?? 1;
    alpha = Math.max(0.15, Math.min(1, life));
    const pulseR = r * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(timeSec * 3)));
    drawSoftCircle(ctx, p.x, p.y, pulseR, `rgba(255,107,107,${0.5 * alpha})`);
    ctx.restore();
    return;
  }

  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = timeSec * 8;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPreview(
  ctx: CanvasRenderingContext2D,
  preview: NonNullable<Preview>,
  lb: Letterbox,
  timeSec: number,
) {
  ctx.save();
  if (preview.kind === 'wall') {
    const p1 = worldToScreen(preview.x1, preview.y1, lb);
    const p2 = worldToScreen(preview.x2, preview.y2, lb);
    ctx.strokeStyle = preview.valid ? TOOL_COLOR.wall : 'rgba(255,107,107,0.9)';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(2, TOOL_DEFS.wall.radius * 0.3 * lb.scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const p = worldToScreen(preview.x, preview.y, lb);
    const r = preview.radius * lb.scale;
    const color = preview.valid ? TOOL_COLOR[preview.tool] : '#ff6b6b';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = timeSec * 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function createSceneRenderer(canvas: HTMLCanvasElement): SceneRenderer {
  const ctx = canvas.getContext('2d')!;
  let cssW = canvas.clientWidth || 1;
  let cssH = canvas.clientHeight || 1;
  let dpr = 1;
  let lb: Letterbox = { x: 0, y: 0, w: cssW, h: cssH, scale: 1 };
  let arrows: ArrowSample[] = [];
  let arrowFrame = 0;
  const ARROW_RECOMPUTE_EVERY = 6;

  function resize(w: number, h: number, ratio: number) {
    cssW = w;
    cssH = h;
    dpr = ratio;
    canvas.width = Math.max(1, Math.round(w * ratio));
    canvas.height = Math.max(1, Math.round(h * ratio));
  }

  function render(state: GameState, timeSec: number, preview: Preview | undefined, boardRect: Rect) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    lb = computeLetterboxIn(boardRect, state.width, state.height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(lb.x, lb.y, lb.w, lb.h);
    ctx.clip();

    // world bounds
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(lb.x + 0.5, lb.y + 0.5, lb.w - 1, lb.h - 1);

    // gravity arrows + cloud-threshold shading (drawn under particles/bodies)
    if (arrowFrame % ARROW_RECOMPUTE_EVERY === 0) arrows = sampleArrows(state);
    arrowFrame++;
    drawGravityArrows(ctx, arrows, lb);
    drawDensityContour(ctx, state, lb);

    // particles
    for (const p of state.particles) {
      const sx = lb.x + p.x * lb.scale;
      const sy = lb.y + p.y * lb.scale;
      const captured = p.bodyId !== 0;
      ctx.globalAlpha = captured ? 0.3 : 0.85;
      ctx.fillStyle = ELEMENT_COLOR[p.el] ?? '#fff';
      const size = captured ? 1 : 1.4;
      ctx.fillRect(sx, sy, size, size);
    }
    ctx.globalAlpha = 1;

    // bodies
    for (const b of state.bodies) {
      const sx = lb.x + b.x * lb.scale;
      const sy = lb.y + b.y * lb.scale;
      drawBody(ctx, b, sx, sy, b.radius * lb.scale);
      drawBodyBadge(ctx, b, sx, sy, b.radius * lb.scale);
    }

    // nodes
    for (const n of state.nodes) {
      drawNode(ctx, n, lb, timeSec);
    }

    // live placement preview
    if (preview) drawPreview(ctx, preview, lb, timeSec);

    // nova flashes
    for (const ev of state.events) {
      if (ev.round !== state.round) continue;
      const age = state.tick - ev.tick;
      if (age < 0 || age > NOVA_FLASH_TICKS) continue;
      const t = age / NOVA_FLASH_TICKS;
      const sx = lb.x + ev.x * lb.scale;
      const sy = lb.y + ev.y * lb.scale;
      const r = (6 + t * 40) * lb.scale * 0.1 * (ev.mass / 10 + 1);
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = ev.kind === 'supernova' ? '#ffd27a' : '#c084fc';
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1, r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  return {
    render,
    resize,
    lastLetterbox: () => lb,
  };
}

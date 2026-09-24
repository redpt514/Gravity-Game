/** Shared world<->screen letterbox math. World is WORLD_W x WORLD_H units,
 * letterboxed (aspect-preserved, centered) into whatever the canvas size is. */
export interface Letterbox {
  x: number; // px offset of world origin
  y: number;
  w: number; // px size of the world rect
  h: number;
  scale: number; // px per world unit
}

/** A screen-space rectangle (px), e.g. the area not covered by HUD chrome. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Letterbox the world into `rect` (aspect-preserved, centered within it) instead of the
 * full canvas. Pass the area NOT covered by the top bar / bottom palette so the board never
 * sits under HUD chrome (see main.ts's board-rect measurement).
 */
export function computeLetterboxIn(rect: Rect, worldW: number, worldH: number): Letterbox {
  const availW = Math.max(1, rect.w);
  const availH = Math.max(1, rect.h);
  const scale = Math.min(availW / worldW, availH / worldH);
  const w = worldW * scale;
  const h = worldH * scale;
  const x = rect.x + (availW - w) / 2;
  const y = rect.y + (availH - h) / 2;
  return { x, y, w, h, scale };
}

/** Convenience: letterbox into the full canvas (no HUD reservation). */
export function computeLetterbox(
  canvasW: number,
  canvasH: number,
  worldW: number,
  worldH: number,
): Letterbox {
  return computeLetterboxIn({ x: 0, y: 0, w: canvasW, h: canvasH }, worldW, worldH);
}

export function screenToWorld(
  sx: number,
  sy: number,
  lb: Letterbox,
): { x: number; y: number } {
  return { x: (sx - lb.x) / lb.scale, y: (sy - lb.y) / lb.scale };
}

export function worldToScreen(
  wx: number,
  wy: number,
  lb: Letterbox,
): { x: number; y: number } {
  return { x: lb.x + wx * lb.scale, y: lb.y + wy * lb.scale };
}

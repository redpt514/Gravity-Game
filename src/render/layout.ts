/** Shared world<->screen letterbox math. World is WORLD_W x WORLD_H units,
 * letterboxed (aspect-preserved, centered) into whatever the canvas size is. */
export interface Letterbox {
  x: number; // px offset of world origin
  y: number;
  w: number; // px size of the world rect
  h: number;
  scale: number; // px per world unit
}

export function computeLetterbox(
  canvasW: number,
  canvasH: number,
  worldW: number,
  worldH: number,
): Letterbox {
  const scale = Math.min(canvasW / worldW, canvasH / worldH);
  const w = worldW * scale;
  const h = worldH * scale;
  const x = (canvasW - w) / 2;
  const y = (canvasH - h) / 2;
  return { x, y, w, h, scale };
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

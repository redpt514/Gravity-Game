/**
 * World size adapts to the board area's aspect ratio so the board fills the window.
 * Area is held constant (160*90) so particle density and level difficulty stay comparable.
 * Grid cells stay 2.5 world units. Aspect is quantized so procedural levels can be cached per bucket.
 */
export const WORLD_AREA = 160 * 90;
export const CELL_SIZE = 2.5;
export const MIN_ASPECT = 0.55;
export const MAX_ASPECT = 2.4;
export const ASPECT_STEP = 0.1;

export interface WorldSize { width: number; height: number; gridW: number; gridH: number; aspect: number }

export function quantizeAspect(aspect: number): number {
  const a = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9));
  return Math.round(a / ASPECT_STEP) / Math.round(1 / ASPECT_STEP);
}

export function worldSizeForAspect(aspect: number): WorldSize {
  const a = quantizeAspect(aspect);
  const gridW = Math.max(8, Math.round(Math.sqrt(WORLD_AREA * a) / CELL_SIZE));
  const gridH = Math.max(8, Math.round(WORLD_AREA / (gridW * CELL_SIZE) / CELL_SIZE));
  return { width: gridW * CELL_SIZE, height: gridH * CELL_SIZE, gridW, gridH, aspect: a };
}

/** The legacy fixed board (160x90, 64x36 grid). Default when no world size is passed; tests and scripted solutions use it. */
export const DEFAULT_WORLD: WorldSize = { width: 160, height: 90, gridW: 64, gridH: 36, aspect: 16 / 9 };

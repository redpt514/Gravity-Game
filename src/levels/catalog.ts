/**
 * Level progression: levels 1-3 are handcrafted (levels.ts), 4+ are procedurally generated and calibrated
 * for the board size (procgen.ts). Generation takes a few seconds, so the UI runs it in procgen.worker.ts
 * and caches by levelCacheKey; getLevelDef memoizes in-process.
 */
import type { LevelDef } from '../sim/types.ts';
import { getLevel } from './levels.ts';
import { generateLevel } from './procgen.ts';
import type { BoardSize } from './bot.ts';

export const HANDCRAFTED_COUNT = 3;
/** Bump when the generator or sim tuning changes, so persisted caches are invalidated. */
export const PROCGEN_VERSION = 2;

export function levelCacheKey(n: number, world: BoardSize): string {
  return `v${PROCGEN_VERSION}:L${n}:${world.width}x${world.height}:${world.gridW}x${world.gridH}`;
}

const memo = new Map<string, LevelDef>();

export function getLevelDef(n: number, world: BoardSize): LevelDef {
  if (n <= HANDCRAFTED_COUNT) return getLevel(n);
  const key = levelCacheKey(n, world);
  let l = memo.get(key);
  if (!l) { l = generateLevel(n, world); memo.set(key, l); }
  return l;
}

/** Seed the memo with a level generated elsewhere (e.g. by the worker). */
export function rememberLevel(n: number, world: BoardSize, level: LevelDef): void {
  memo.set(levelCacheKey(n, world), level);
}

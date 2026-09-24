/// <reference lib="webworker" />
/**
 * Module worker: generates procedural levels off the main thread.
 * Load: new Worker(new URL('../levels/procgen.worker.ts', import.meta.url), { type: 'module' })
 * Request: { n, world: {width, height, gridW, gridH} } -> reply { n, key, level } (or { n, key, error }).
 */
import { getLevelDef, levelCacheKey } from './catalog.ts';
import type { BoardSize } from './bot.ts';

interface Req { n: number; world: BoardSize }

self.onmessage = (ev: MessageEvent<Req>) => {
  const { n, world } = ev.data;
  const key = levelCacheKey(n, world);
  try {
    const level = getLevelDef(n, world);
    (self as unknown as Worker).postMessage({ n, key, level });
  } catch (e) {
    (self as unknown as Worker).postMessage({ n, key, error: String(e instanceof Error ? e.message : e) });
  }
};

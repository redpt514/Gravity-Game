/**
 * Level select + procedural-level orchestration for the front end. Handcrafted levels
 * (id <= HANDCRAFTED_COUNT) come from src/levels/levels.ts; levels beyond that are generated
 * off the main thread by src/levels/procgen.worker.ts (which wraps catalog.ts's
 * getLevelDef/generateLevel — "may take a few seconds") and cached here in memory +
 * localStorage, keyed by catalog.ts's levelCacheKey.
 */
import type { LevelDef } from '../sim/types';
import type { WorldSize } from '../sim/worldSize';
import { HANDCRAFTED_COUNT, levelCacheKey } from '../levels/catalog';

const CACHE_PREFIX = 'gravity-game:level:';
const memCache = new Map<string, LevelDef>();
const pending = new Map<string, Promise<LevelDef>>();
const listeners = new Set<() => void>();

export function handcraftedCount(): number {
  return HANDCRAFTED_COUNT;
}

function readLocal(key: string): LevelDef | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as LevelDef) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, level: LevelDef) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(level));
  } catch {
    /* storage unavailable/full; the in-memory cache still holds it for this session */
  }
}

let worker: Worker | null = null;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../levels/procgen.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

/** Cache-only lookup (memory, then localStorage); never triggers generation. */
export function peek(n: number, world: WorldSize): LevelDef | null {
  const key = levelCacheKey(n, world);
  const mem = memCache.get(key);
  if (mem) return mem;
  const local = readLocal(key);
  if (local) memCache.set(key, local);
  return local;
}

export function isPending(n: number, world: WorldSize): boolean {
  return pending.has(levelCacheKey(n, world));
}

/** Resolves from cache immediately, or generates off the main thread in procgen.worker.ts.
 * Never blocks the UI: generation itself may take a few seconds, running entirely in the
 * worker. */
export function getOrGenerate(n: number, world: WorldSize): Promise<LevelDef> {
  const key = levelCacheKey(n, world);
  const cached = peek(n, world);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const p = new Promise<LevelDef>((resolve) => {
    const w = getWorker();
    const onMsg = (ev: MessageEvent<{ n: number; key: string; level?: LevelDef; error?: string }>) => {
      if (ev.data.key !== key) return;
      w.removeEventListener('message', onMsg);
      pending.delete(key);
      if (ev.data.level) {
        memCache.set(key, ev.data.level);
        writeLocal(key, ev.data.level);
        resolve(ev.data.level);
        for (const l of listeners) l();
      } else {
        console.warn('[levelSource] generation failed for level', n, ev.data.error);
        // never leave the caller hanging: fall through with a minimal placeholder
        resolve({
          id: n,
          name: `Level ${n}`,
          intro: 'A region of the nursery.',
          seed: n,
          particleCount: 1800,
          initialMix: { H: 1 },
          rounds: 3,
          ticksPerRound: 600,
          startingEnergy: 80,
          incomePerRound: 40,
          ambientGravity: 0.3,
          tools: ['repulsor', 'wall'],
          goals: [{ type: 'clouds', count: 1, byRound: 3, label: 'Form 1 particle cloud' }],
        });
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ n, world });
  });
  pending.set(key, p);
  return p;
}

/** Fire-and-forget: used to pre-chart upcoming levels without the player waiting on them. */
export function prefetch(n: number, world: WorldSize) {
  if (peek(n, world) || isPending(n, world)) return;
  void getOrGenerate(n, world);
}

/** Notified whenever a background generation completes, so the level select can re-render its
 * locked preview cards without polling. */
export function onGenerated(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function goalSummary(level: LevelDef): string {
  return level.goals.map((g) => g.label).join(' · ');
}

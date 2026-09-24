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
let workerBroken = false;
function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('../levels/procgen.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('error', () => {
        // e.g. a sandbox that blocks workers: everything pending falls back to the main thread
        workerBroken = true;
        worker = null;
        for (const [key, fb] of fallbacks) {
          fallbacks.delete(key);
          fb();
        }
      });
    } catch {
      workerBroken = true;
      worker = null;
    }
  }
  return worker;
}
/** per-key main-thread fallbacks, run if the worker dies before answering */
const fallbacks = new Map<string, () => void>();

/** Main-thread generation (blocks for a few seconds); only used when workers are unavailable. */
async function generateOnMainThread(n: number, world: WorldSize): Promise<LevelDef> {
  const { getLevelDef } = await import('../levels/catalog');
  await new Promise((r) => setTimeout(r, 50)); // let the "Charting galaxy…" card paint first
  return getLevelDef(n, world);
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
    const finish = (level: LevelDef) => {
      pending.delete(key);
      fallbacks.delete(key);
      memCache.set(key, level);
      writeLocal(key, level);
      resolve(level);
      for (const l of listeners) l();
    };
    const runFallback = () => {
      generateOnMainThread(n, world).then(finish, (err) => {
        console.warn('[levelSource] main-thread generation failed for level', n, err);
        finish(placeholderLevel(n));
      });
    };
    const w = getWorker();
    if (!w) {
      runFallback();
      return;
    }
    fallbacks.set(key, () => {
      w.removeEventListener('message', onMsg);
      runFallback();
    });
    const onMsg = (ev: MessageEvent<{ n: number; key: string; level?: LevelDef; error?: string }>) => {
      if (ev.data.key !== key) return;
      w.removeEventListener('message', onMsg);
      if (ev.data.level) {
        finish(ev.data.level);
      } else {
        console.warn('[levelSource] generation failed for level', n, ev.data.error);
        // never leave the caller hanging: fall through with a minimal placeholder
        finish(placeholderLevel(n));
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ n, world });
  });
  pending.set(key, p);
  return p;
}

function placeholderLevel(n: number): LevelDef {
  return {
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
  };
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

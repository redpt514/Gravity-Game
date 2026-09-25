import { describe, expect, it } from 'vitest';
import { createGame, debugSpawnBody, playTimeline } from '../src/sim/game.ts';
import { forceAt } from '../src/sim/force.ts';
import { computeField } from '../src/sim/field.ts';
import { worldOf } from '../src/sim/world.ts';
import { DEFAULT_WORLD, worldSizeForAspect } from '../src/sim/worldSize.ts';
import { getLevel } from '../src/levels/levels.ts';
import type { TimedAction } from '../src/sim/types.ts';
import { replay } from './solutions.ts';

describe('adaptive world size', () => {
  it('defaults to the legacy 160x90 board', () => {
    const s = createGame(1).state();
    expect([s.width, s.height, s.gridW, s.gridH]).toEqual([DEFAULT_WORLD.width, DEFAULT_WORLD.height, DEFAULT_WORLD.gridW, DEFAULT_WORLD.gridH]);
  });

  for (const aspect of [0.6, 2.2]) {
    it(`level 1 at aspect ${aspect}: pinching the current clears it, placing nothing misses the goal`, () => {
      const world = worldSizeForAspect(aspect);
      const W = world.width, H = world.height;
      // pinch the current against the board's long edges (across the short dimension)
      const pts = H > W ? [[W / 4, H / 2], [(3 * W) / 4, H / 2]] : [[W / 2, H / 4], [W / 2, (3 * H) / 4]];
      for (const seed of [undefined, 1, 2]) {
        const g = createGame(1, seed, { world });
        const s = g.state();
        expect([s.width, s.height, s.gridW, s.gridH]).toEqual([W, H, world.gridW, world.gridH]);
        expect(s.field.length).toBe(world.gridW * world.gridH);
        expect(s.particles.every((p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H)).toBe(true);
        const acts: TimedAction[] = pts.map(([x, y]) => ({ t: 0, action: { type: 'place', tool: 'repulsor', x, y } }));
        expect(replay(g, acts).every((r) => r.ok)).toBe(true);
        expect(`seed ${seed}: ${g.state().phase}`).toBe(`seed ${seed}: cleared`);
        const idle = createGame(1, seed, { world });
        playTimeline(idle, [], { untilSec: idle.state().level.goals[0].deadlineSec });
        expect(idle.state().goals[0].missed).toBe(true);
      }
    }, 60000);
  }

  it('opts.level plays the given LevelDef', () => {
    const level = { ...getLevel(2), id: 42, name: 'Custom', particleCount: 500 };
    const s = createGame(42, undefined, { level }).state();
    expect(s.level.name).toBe('Custom');
    expect(s.particles.length).toBe(500);
  });
});

describe('forceAt', () => {
  it('points toward a heavy body and away from a repulsor', () => {
    const g = createGame(1);
    const s = g.state();
    debugSpawnBody(g, 'star_ms', 80, 45, 400);
    computeField(worldOf(s)!);
    for (const [x, y] of [[88, 45], [80, 53], [73, 40]]) {
      const f = forceAt(s, x, y);
      expect(f.x * (80 - x) + f.y * (45 - y)).toBeGreaterThan(0);
    }
    g.apply({ type: 'place', tool: 'repulsor', x: 40, y: 45 });
    for (const [x, y] of [[48, 45], [40, 37], [33, 50]]) {
      const f = forceAt(s, x, y);
      expect(f.x * (x - 40) + f.y * (y - 45)).toBeGreaterThan(0);
    }
    const out = { x: 0, y: 0 };
    expect(forceAt(s, 48, 45, out)).toBe(out);
  });
});

describe('level catalog', () => {
  it('levels 1-3 are handcrafted and cache keys depend on n and board size', async () => {
    const { HANDCRAFTED_COUNT, getLevelDef, levelCacheKey } = await import('../src/levels/catalog.ts');
    expect(HANDCRAFTED_COUNT).toBe(3);
    for (const n of [1, 2, 3]) expect(getLevelDef(n, DEFAULT_WORLD)).toBe(getLevel(n));
    const a = worldSizeForAspect(0.6), b = worldSizeForAspect(2.2);
    expect(levelCacheKey(4, a)).not.toBe(levelCacheKey(4, b));
    expect(levelCacheKey(4, a)).not.toBe(levelCacheKey(5, a));
    expect(levelCacheKey(4, a)).toBe(levelCacheKey(4, worldSizeForAspect(0.61)));
  });
});

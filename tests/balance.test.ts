import { describe, expect, it } from 'vitest';
import { createGame, playTimeline } from '../src/sim/game.ts';
import { SOLUTIONS, replay } from './solutions.ts';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const HANDCRAFTED = SOLUTIONS.filter((s) => s.level <= 3);

describe('balance (levels 1-3)', () => {
  for (const sol of HANDCRAFTED) {
    it(`level ${sol.level}: the reference timeline clears on seeds 1-8 with every goal in time`, () => {
      for (const seed of SEEDS) {
        const g = createGame(sol.level, seed);
        expect(replay(g, sol.timeline).every((r) => r.ok)).toBe(true);
        const s = g.state();
        expect(`seed ${seed}: ${s.phase}`).toBe(`seed ${seed}: cleared`);
        expect(s.stars).toBe(3);
        for (const x of s.goals) expect(x.missed).toBe(false);
      }
    }, 120000);

    it(`level ${sol.level}: placing nothing misses every goal on seeds 1-8`, () => {
      for (const seed of SEEDS) {
        const g = createGame(sol.level, seed);
        playTimeline(g, [], { untilSec: Math.max(...g.state().level.goals.map((x) => x.deadlineSec)) });
        for (const x of g.state().goals) expect(`seed ${seed} ${x.goal.label}: ${x.missed}`).toBe(`seed ${seed} ${x.goal.label}: true`);
      }
    }, 120000);
  }
});

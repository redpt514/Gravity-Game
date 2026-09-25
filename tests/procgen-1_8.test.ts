import { describe, expect, it } from 'vitest';
import { createGame, playTimeline } from '../src/sim/game.ts';
import { worldSizeForAspect } from '../src/sim/worldSize.ts';
import { generateLevelReport } from '../src/levels/procgen.ts';
import { replay } from './solutions.ts';

const ASPECT = 1.8;
const world = worldSizeForAspect(ASPECT);

describe(`procedural levels at aspect ${ASPECT}`, () => {
  for (const n of [4, 5, 6, 7, 8]) {
    it(`level ${n}: calibrated, cleared by the bot timeline, idle misses every goal, generated in < 6 s standalone`, () => {
      const rep = generateLevelReport(n, world);
      const L = rep.level;
      // ~4.5-5.5 s standalone in node; vitest runs the test files in parallel, so allow headroom here
      expect(rep.ms).toBeLessThan(10000);
      expect(L.id).toBe(n);
      expect(L.goals.length).toBeGreaterThanOrEqual(2);
      for (const g of L.goals) { expect(g.count).toBeGreaterThan(0); expect(g.deadlineSec).toBeGreaterThan(0); expect(g.points).toBeGreaterThan(0); }
      expect(L.solution!.length).toBeGreaterThan(0);
      // the recorded bot timeline clears the final LevelDef with every goal in time
      const g = createGame(n, undefined, { level: L, world });
      expect(replay(g, L.solution!).every((r) => r.ok)).toBe(true);
      expect(g.state().phase).toBe('cleared');
      expect(g.state().stars).toBe(3);
      // placing nothing misses every goal that is due within the idle check
      const idle = createGame(n, undefined, { level: L, world });
      playTimeline(idle, [], { untilSec: Math.min(rep.idleChecked, Math.max(...L.goals.map((x) => x.deadlineSec))) });
      for (const x of idle.state().goals) expect(x.met && !x.missed).toBe(false);
      if (n === 4) {
        const again = generateLevelReport(n, world).level;
        expect(JSON.stringify(again)).toBe(JSON.stringify(L));
      }
    }, 60000);
  }
});

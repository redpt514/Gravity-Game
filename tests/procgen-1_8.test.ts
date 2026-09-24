import { describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/game.ts';
import { worldSizeForAspect } from '../src/sim/worldSize.ts';
import { generateLevelReport } from '../src/levels/procgen.ts';
import { replay } from './solutions.ts';
import type { Action } from '../src/sim/types.ts';

const ASPECT = 1.8;
const world = worldSizeForAspect(ASPECT);

describe(`procedural levels at aspect ${ASPECT}`, () => {
  for (const n of [4, 5, 6, 7, 8]) {
    it(`level ${n}: calibrated, won by the bot line, lost by placing nothing, generated in < 8 s`, () => {
      const rep = generateLevelReport(n, world);
      const L = rep.level;
      expect(rep.ms).toBeLessThan(8000);
      expect(L.id).toBe(n);
      expect(L.goals.length).toBeGreaterThanOrEqual(2);
      for (const g of L.goals) { expect(g.count).toBeGreaterThan(0); expect(g.byRound).toBeLessThanOrEqual(L.rounds); }
      expect(L.rounds).toBeLessThanOrEqual(7);
      // the recorded bot line wins the final LevelDef
      const g = createGame(n, undefined, { level: L, world });
      const res = replay(g, L.solution!);
      expect(res.every((r) => r.ok)).toBe(true);
      expect(g.state().phase).toBe('won');
      // place-nothing loses
      const idle = createGame(n, undefined, { level: L, world });
      const end: Action[] = Array.from({ length: L.rounds }, () => ({ type: 'endRound' }));
      replay(idle, end);
      expect(idle.state().phase).toBe('lost');
      if (n === 4) {
        // deterministic in (n, world)
        const again = generateLevelReport(n, world).level;
        expect(JSON.stringify(again)).toBe(JSON.stringify(L));
      }
    }, 60000);
  }
});

import { describe, expect, it } from 'vitest';
import { applyActions, createGame } from '../src/sim/game.ts';
import type { Action, Game } from '../src/sim/types.ts';
import { SOLUTIONS, replay } from './solutions.ts';

/** Run every remaining round, calling perRound(g, round) in each plan phase. */
function play(level: number, seed: number, perRound: (g: Game, round: number) => void = () => {}): Game {
  const g = createGame(level, seed);
  g.apply({ type: 'start' });
  while (g.state().phase === 'plan') {
    perRound(g, g.state().round);
    applyActions(g, [{ type: 'endRound' }]);
    if (g.state().phase === 'roundEnd') g.apply({ type: 'start' });
  }
  return g;
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe('balance', () => {
  for (const sol of SOLUTIONS) {
    it(`level ${sol.level}: scripted solution wins on seeds 1-8, in the last or second-to-last round`, () => {
      for (const seed of SEEDS) {
        const g = createGame(sol.level, seed);
        replay(g, sol.actions);
        const s = g.state();
        expect(`seed ${seed}: ${s.phase}`).toBe(`seed ${seed}: won`);
        expect(s.round).toBeGreaterThanOrEqual(Math.max(1, s.level.rounds - 1));
      }
    }, 120000);

    it(`level ${sol.level}: placing nothing loses on seeds 1-8`, () => {
      for (const seed of SEEDS) expect(play(sol.level, seed).state().phase).toBe('lost');
    }, 120000);
  }

  it('a lone lens at the centre wins none of levels 3-5 (seeds 1-3)', () => {
    for (const L of [3, 4, 5]) for (const seed of [1, 2, 3]) {
      const g = play(L, seed, (gg, r) => { if (r === 1) expect(gg.apply({ type: 'place', tool: 'lens', x: 80, y: 45 }).ok).toBe(true); });
      expect(`L${L} s${seed}: ${g.state().phase}`).toBe(`L${L} s${seed}: lost`);
    }
  }, 120000);

  it('L3: a repulsor placed upstream of the pile in round 2 changes the body mass by >= 15%', () => {
    const wallTop: Action = { type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 };
    const biggest = (g: Game) => Math.max(...g.state().bodies.map((b) => b.mass));
    for (const seed of [1, 2, 303]) {
      const base = createGame(3, seed), push = createGame(3, seed);
      applyActions(base, [wallTop, { type: 'endRound' }, { type: 'endRound' }]);
      applyActions(push, [wallTop, { type: 'endRound' }, { type: 'place', tool: 'repulsor', x: 105, y: 15 }, { type: 'endRound' }]);
      const a = biggest(base), b = biggest(push);
      expect(Math.abs(b - a) / a).toBeGreaterThanOrEqual(0.15);
    }
  }, 60000);
});

import { describe, expect, it } from 'vitest';
import { applyActions, createGame, debugSpawnBody } from '../src/sim/game.ts';
import { LEVELS } from '../src/levels/levels.ts';
import { TOOL_DEFS } from '../src/sim/tools.ts';
import type { Action } from '../src/sim/types.ts';
import { SOLUTIONS, replay } from './solutions.ts';

describe('levels', () => {
  it('defines levels 1-5 with sane data', () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5]);
    for (const l of LEVELS) {
      expect(l.goals.length).toBeGreaterThan(0);
      for (const g of l.goals) expect(g.byRound).toBeLessThanOrEqual(l.rounds);
      const reps = Math.floor(l.startingEnergy / TOOL_DEFS.repulsor.cost);
      expect(reps).toBeGreaterThanOrEqual(2);
      expect(reps).toBeLessThanOrEqual(3);
    }
    expect(LEVELS[4].rewards?.black_hole).toBe(1);
  });

  for (const sol of SOLUTIONS) {
    it(`level ${sol.level} is won by its scripted solution`, () => {
      const g = createGame(sol.level);
      const res = replay(g, sol.actions);
      expect(res.every((r) => r.ok)).toBe(true);
      const s = g.state();
      expect(s.phase).toBe('won');
      expect(s.goals.every((x) => x.met)).toBe(true);
    }, 30000);

    it(`level ${sol.level} is lost by placing nothing`, () => {
      const g = createGame(sol.level);
      const idle: Action[] = Array.from({ length: g.state().level.rounds }, () => ({ type: 'endRound' }));
      applyActions(g, idle);
      expect(g.state().phase).toBe('lost');
    }, 30000);
  }

  it('winning level 5 grants the black hole reward', () => {
    const g = createGame(5);
    replay(g, SOLUTIONS.find((x) => x.level === 5)!.actions);
    expect(g.state().phase).toBe('won');
    expect(g.state().inventory.black_hole).toBe(1);
    expect(g.help()).toMatch(/REWARD on win: black_hole x1/);
  }, 30000);
});

describe('game rules', () => {
  it('phase machine intro -> plan -> running -> roundEnd -> plan', () => {
    const g = createGame(1);
    const s = () => g.state();
    expect(s().phase).toBe('intro');
    expect(g.step(10)).toBe(false);
    expect(s().totalTick).toBe(0);
    expect(g.apply({ type: 'endRound' }).ok).toBe(true);
    expect(s().phase).toBe('plan');
    expect(g.apply({ type: 'endRound' }).ok).toBe(true);
    expect(s().phase).toBe('running');
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 10, y: 10 }).ok).toBe(false);
    expect(g.apply({ type: 'endRound' }).ok).toBe(false);
    expect(g.step(100)).toBe(true);
    g.runRound();
    expect(s().phase).toBe('roundEnd');
    expect(s().energy).toBe(s().level.startingEnergy + s().level.incomePerRound);
    expect(g.apply({ type: 'start' }).ok).toBe(true);
    expect(s().phase).toBe('plan');
    expect(s().round).toBe(2);
  });

  it('validates placement: board, energy, palette', () => {
    const g = createGame(1);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: -5, y: 10 }).ok).toBe(false);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 10, y: 200 }).ok).toBe(false);
    expect(g.apply({ type: 'place', tool: 'wall', x: 10, y: 10, x2: 40, y2: 10 }).ok).toBe(false); // not in L1 palette
    expect(g.apply({ type: 'place', tool: 'black_hole', x: 10, y: 10 }).ok).toBe(false);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 40, y: 40 }).ok).toBe(true);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 90, y: 40 }).ok).toBe(true);
    const r = g.apply({ type: 'place', tool: 'repulsor', x: 120, y: 40 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/energy/);
    expect(g.state().energy).toBe(70 - 60);
  });

  it('rejects bad walls and stacked nodes with a reason', () => {
    const g = createGame(2);
    const bad = (a: Parameters<typeof g.apply>[0], re: RegExp) => {
      const e = g.state().energy;
      const r = g.apply(a);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(re);
      expect(g.state().energy).toBe(e);
    };
    bad({ type: 'place', tool: 'wall', x: 80, y: 45 }, /end point/);
    bad({ type: 'place', tool: 'wall', x: 80, y: 45, x2: 82, y2: 46 }, /too short/);
    bad({ type: 'place', tool: 'wall', x: 10, y: 10, x2: 150, y2: 80 }, /too long/);
    expect(g.apply({ type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 }).ok).toBe(true);
    bad({ type: 'place', tool: 'wall', x: 81, y: 1, x2: 81, y2: 44 }, /too close/);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 40, y: 45 }).ok).toBe(true);
    bad({ type: 'place', tool: 'repulsor', x: 42, y: 47 }, /too close/);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 45, y: 45 }).ok).toBe(false); // energy, not spacing
  });

  it('winning scores leftover energy; losing lists only goals that were due', () => {
    const g = createGame(1);
    replay(g, SOLUTIONS[0].actions);
    const s = g.state();
    expect(s.phase).toBe('won');
    expect(s.scoreboard.energyBonus).toBe(s.energy);
    expect(s.scoreboard.score).toBeGreaterThanOrEqual(s.energy + 10);
    const l = createGame(2);
    applyActions(l, [{ type: 'endRound' }, { type: 'endRound' }]);
    expect(l.state().phase).toBe('lost');
    const msg = l.state().log.find((x) => x.includes('Level lost'))!;
    expect(msg).toMatch(/2 clouds/);
    expect(msg).not.toMatch(/planet/);
  }, 30000);

  it('remove refunds 50% only in the round placed', () => {
    const g = createGame(1);
    g.apply({ type: 'place', tool: 'repulsor', x: 40, y: 40 });
    g.apply({ type: 'place', tool: 'repulsor', x: 100, y: 40 });
    const [n1, n2] = g.state().nodes;
    expect(n2).toBeDefined();
    expect(g.apply({ type: 'remove', nodeId: n1.id }).ok).toBe(true);
    expect(g.state().energy).toBe(10 + 15);
    applyActions(g, [{ type: 'endRound' }]);
    g.apply({ type: 'start' });
    const e = g.state().energy;
    expect(g.apply({ type: 'remove', nodeId: n2.id }).ok).toBe(true);
    expect(g.state().energy).toBe(e);
    expect(g.apply({ type: 'remove', nodeId: 999 }).ok).toBe(false);
  });

  it('inventory tools are free and usable outside the palette', () => {
    const g = createGame(1, undefined, { inventory: { black_hole: 1 } });
    const e = g.state().energy;
    expect(g.apply({ type: 'place', tool: 'black_hole', x: 80, y: 45 }).ok).toBe(true);
    expect(g.state().energy).toBe(e);
    expect(g.state().inventory.black_hole).toBe(0);
    expect(g.apply({ type: 'place', tool: 'black_hole', x: 30, y: 45 }).ok).toBe(false);
    const before = g.state().particles.length;
    applyActions(g, [{ type: 'endRound' }]);
    expect(g.state().particles.length).toBeLessThan(before); // swallowed gas
    expect(g.state().nodes[0].mass!).toBeGreaterThan(100);
  });

  it('red matter collapses a cloud it touches into a star and is spent', () => {
    const g = createGame(1, undefined, { inventory: { red_matter: 1 } });
    g.apply({ type: 'endRound' });
    expect(g.apply({ type: 'place', tool: 'red_matter', x: 80, y: 45 }).ok).toBe(true);
    g.apply({ type: 'endRound' });
    const cloud = debugSpawnBody(g, 'cloud', 82, 45, 20);
    g.step(1);
    expect(cloud.kind).toBe('star_ms');
    expect(g.state().nodes.length).toBe(0);
  });

  it('pulse lasts one round', () => {
    const g = createGame(4);
    g.apply({ type: 'place', tool: 'pulse', x: 80, y: 45 });
    expect(g.state().nodes.length).toBe(1);
    applyActions(g, [{ type: 'endRound' }]);
    expect(g.state().nodes.length).toBe(0);
  });

  it('help() summarises rules, goals and tools', () => {
    const h = createGame(3).help();
    expect(h).toMatch(/GOALS/);
    expect(h).toMatch(/lens: cost 80/);
    expect(h).not.toMatch(/pulse:/);
  });
});

describe('performance', () => {
  it('steps 600 ticks with 3000 particles quickly', () => {
    const g = createGame(5);
    applyActions(g, [{ type: 'place', tool: 'repulsor', x: 60, y: 45 }]);
    g.apply({ type: 'endRound' });
    const t = performance.now();
    g.runRound();
    const ms = performance.now() - t;
    expect(g.state().particles.length).toBeGreaterThanOrEqual(2900);
    expect(ms).toBeLessThan(1000);
  }, 10000);
});

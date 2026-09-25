import { describe, expect, it } from 'vitest';
import { createGame, debugSpawnBody, hashState, hintCostOf, playTimeline } from '../src/sim/game.ts';
import { LEVELS } from '../src/levels/levels.ts';
import { TOOL_DEFS } from '../src/sim/tools.ts';
import { POINTS } from '../src/sim/params.ts';
import { GRACE_SEC, TICKS_PER_SECOND } from '../src/sim/types.ts';
import { SOLUTIONS, replay } from './solutions.ts';

describe('levels', () => {
  it('defines levels 1-5 with sane data', () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5]);
    for (const l of LEVELS) {
      expect(l.goals.length).toBeGreaterThan(0);
      expect(l.incomePerSec).toBeGreaterThan(0);
      for (const g of l.goals) { expect(g.deadlineSec).toBeGreaterThan(0); expect(g.points).toBeGreaterThan(0); }
      const reps = Math.floor(l.startingEnergy / TOOL_DEFS.repulsor.cost);
      expect(reps).toBeGreaterThanOrEqual(2);
      expect(reps).toBeLessThanOrEqual(3);
    }
    expect(LEVELS[4].rewards?.black_hole).toBe(1);
  });

  it('help() summarises rules, goals, points, hints and tools', () => {
    const h = createGame(3).help();
    expect(h).toMatch(/GOALS/);
    expect(h).toMatch(/within 60s/);
    expect(h).toMatch(/POINTS: cloud 20/);
    expect(h).toMatch(/HINT/);
    expect(h).toMatch(/lens: cost 80/);
    expect(h).not.toMatch(/pulse:/);
  });
});

describe('continuous clock', () => {
  it('intro is paused; the first action starts the clock; step always advances while playing', () => {
    const g = createGame(1);
    const s = () => g.state();
    expect(s().phase).toBe('intro');
    g.step(10);
    expect(s().totalTick).toBe(0);
    expect(g.apply({ type: 'start' }).ok).toBe(true);
    expect(g.apply({ type: 'start' }).ok).toBe(false);
    g.step(30);
    expect(s().time).toBe(1);
    g.runFor(4);
    expect(s().time).toBe(5);
    expect(s().energy).toBeCloseTo(70 + 5 * s().level.incomePerSec, 6);
    // placing works at any time, and in intro it starts the clock
    const g2 = createGame(1);
    expect(g2.apply({ type: 'place', tool: 'repulsor', x: 40, y: 40 }).ok).toBe(true);
    expect(g2.state().phase).toBe('playing');
  });

  it('validates placement: board, energy, palette', () => {
    const g = createGame(1);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: -5, y: 10 }).ok).toBe(false);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 10, y: 200 }).ok).toBe(false);
    expect(g.apply({ type: 'place', tool: 'wall', x: 10, y: 10, x2: 40, y2: 10 }).ok).toBe(false);
    expect(g.apply({ type: 'place', tool: 'black_hole', x: 10, y: 10 }).ok).toBe(false);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 40, y: 40 }).ok).toBe(true);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 90, y: 40 }).ok).toBe(true);
    const r = g.apply({ type: 'place', tool: 'repulsor', x: 120, y: 40 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/energy/);
    expect(g.state().energy).toBe(10);
    // income makes it affordable later
    g.runFor(20 / g.state().level.incomePerSec + 0.1);
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 120, y: 40 }).ok).toBe(true);
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
  });

  it(`remove refunds in full within ${GRACE_SEC}s of placing, nothing after`, () => {
    const g = createGame(1);
    g.apply({ type: 'place', tool: 'repulsor', x: 40, y: 40 });
    g.apply({ type: 'place', tool: 'repulsor', x: 100, y: 40 });
    const [n1, n2] = g.state().nodes;
    g.runFor(GRACE_SEC - 1);
    let e = g.state().energy;
    expect(g.apply({ type: 'remove', nodeId: n1.id }).ok).toBe(true);
    expect(g.state().energy).toBeCloseTo(e + 30, 9);
    g.runFor(2);
    e = g.state().energy;
    expect(g.apply({ type: 'remove', nodeId: n2.id }).ok).toBe(true);
    expect(g.state().energy).toBe(e);
    expect(g.state().nodes.length).toBe(0);
    expect(g.apply({ type: 'remove', nodeId: 999 }).ok).toBe(false);
  });

  it(`move is free within ${GRACE_SEC}s of placing and rejected after`, () => {
    const g = createGame(2);
    g.apply({ type: 'start' });
    expect(g.apply({ type: 'place', tool: 'wall', x: 40, y: 40, x2: 60, y2: 40 }).ok).toBe(true);
    const e = g.state().energy;
    const wall = g.state().nodes[0];
    expect(g.apply({ type: 'move', nodeId: wall.id, x: 50, y: 60 }).ok).toBe(true);
    expect([wall.x, wall.y, wall.x2, wall.y2]).toEqual([50, 60, 70, 60]);
    expect(g.state().energy).toBe(e);
    expect(g.apply({ type: 'move', nodeId: wall.id, x: -5, y: 60 }).ok).toBe(false);
    expect(g.apply({ type: 'move', nodeId: wall.id, x: 50, y: 60, x2: 51, y2: 60 }).ok).toBe(false);
    expect(g.apply({ type: 'move', nodeId: 999, x: 10, y: 10 }).ok).toBe(false);
    g.runFor(GRACE_SEC + 0.5);
    const r = g.apply({ type: 'move', nodeId: wall.id, x: 30, y: 30 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/within/);
  });

  it('inventory tools are free and usable outside the palette', () => {
    const g = createGame(1, undefined, { inventory: { black_hole: 1 } });
    const e = g.state().energy;
    expect(g.apply({ type: 'place', tool: 'black_hole', x: 80, y: 45 }).ok).toBe(true);
    expect(g.state().energy).toBe(e);
    expect(g.state().inventory.black_hole).toBe(0);
    expect(g.apply({ type: 'place', tool: 'black_hole', x: 30, y: 45 }).ok).toBe(false);
    const before = g.state().particles.length;
    g.runFor(20);
    expect(g.state().particles.length).toBeLessThan(before);
    expect(g.state().nodes[0].mass!).toBeGreaterThan(100);
  });

  it('red matter collapses a cloud it touches into a star and is spent', () => {
    const g = createGame(1, undefined, { inventory: { red_matter: 1 } });
    expect(g.apply({ type: 'place', tool: 'red_matter', x: 80, y: 45 }).ok).toBe(true);
    const cloud = debugSpawnBody(g, 'cloud', 82, 45, 20);
    g.step(1);
    expect(cloud.kind).toBe('star_ms');
    expect(g.state().nodes.length).toBe(0);
  });

  it('pulse expires after durationSec', () => {
    const g = createGame(4);
    g.apply({ type: 'place', tool: 'pulse', x: 80, y: 45 });
    const n = g.state().nodes[0];
    expect(n.expiresAt).toBe(TOOL_DEFS.pulse.durationSec);
    g.runFor(TOOL_DEFS.pulse.durationSec! - 1);
    expect(g.state().nodes.length).toBe(1);
    g.runFor(1);
    expect(g.state().nodes.length).toBe(0);
  });
});

describe('goals and points', () => {
  it('goal counts down, is marked missed at 0, still completes later; stars = 3 - missed', () => {
    const g = createGame(1);
    g.apply({ type: 'start' });
    g.runFor(10);
    const gs = g.state().goals[0];
    expect(gs.remainingSec).toBeCloseTo(gs.goal.deadlineSec - 10, 6);
    g.runFor(gs.goal.deadlineSec - 10);
    expect(gs.missed).toBe(true);
    expect(gs.remainingSec).toBe(0);
    expect(g.state().log.some((l) => /Time's up/.test(l))).toBe(true);
    expect(g.state().phase).toBe('playing');
    debugSpawnBody(g, 'cloud', 80, 45, 20);
    g.step(1);
    expect(gs.met).toBe(true);
    expect(g.state().phase).toBe('cleared');
    expect(g.state().stars).toBe(2);
    expect(g.state().scoreboard.pointsBy.goals).toBe(gs.goal.points); // no early bonus
  });

  it('meeting a goal early pays goal.points x (1 + remaining/deadline), latched with metAt', () => {
    const g = createGame(1);
    g.apply({ type: 'start' });
    g.runFor(5);
    debugSpawnBody(g, 'cloud', 80, 45, 20);
    g.step(1);
    const s = g.state(), gs = s.goals[0];
    expect(gs.met).toBe(true);
    expect(gs.metAt).toBeCloseTo(5 + 1 / TICKS_PER_SECOND, 6);
    const d = gs.goal.deadlineSec;
    expect(s.scoreboard.pointsBy.goals).toBe(Math.round(gs.goal.points * (1 + (d - gs.metAt!) / d)));
    expect(s.phase).toBe('cleared');
    expect(s.stars).toBe(3);
    // latched: the cloud vanishing does not unmeet it; frozen countdown
    s.bodies.length = 0;
    const rem = gs.remainingSec;
    g.runFor(2);
    expect(gs.met).toBe(true);
    expect(gs.remainingSec).toBe(rem);
  });

  it('the grid keeps running after cleared, and points keep accruing', () => {
    const g = createGame(3);
    replay(g, SOLUTIONS.find((x) => x.level === 3)!.timeline);
    expect(g.state().phase).toBe('cleared');
    const t = g.state().totalTick, p = g.state().scoreboard.points, h = hashState(g.state());
    g.runFor(10);
    expect(g.state().phase).toBe('cleared');
    expect(g.state().totalTick).toBe(t + 300);
    expect(hashState(g.state())).not.toBe(h);
    expect(g.state().scoreboard.points).toBeGreaterThan(p); // the star keeps fusing He
    expect(g.apply({ type: 'place', tool: 'repulsor', x: 20, y: 70 }).ok).toBe(true);
  }, 30000);

  it('clearing level 5 grants the black hole reward', () => {
    const g = createGame(5);
    g.apply({ type: 'start' });
    g.state().goals.forEach((x) => { x.goal = { ...x.goal, count: 0 }; });
    g.step(1);
    expect(g.state().phase).toBe('cleared');
    expect(g.state().inventory.black_hole).toBe(1);
    expect(g.help()).toMatch(/REWARD on clear: black_hole x1/);
  });

  it('points are the start float plus pointsBy minus hints, never negative', () => {
    const g = createGame(1);
    const sb = g.state().scoreboard;
    expect(sb.points).toBe(POINTS.startPoints);
    g.apply({ type: 'hint' });
    expect(sb.points).toBe(POINTS.startPoints - POINTS.hintCost);
    expect(sb.points).toBeGreaterThanOrEqual(0);
    const pb = sb.pointsBy;
    g.runFor(3);
    expect(sb.points).toBe(POINTS.startPoints + pb.clouds + pb.planets + pb.stars + pb.novae + pb.elements + pb.goals - pb.spentHints);
  });
});

describe('hints', () => {
  it('cost escalates per use, is rejected when broke, and does not touch the live world', () => {
    const g = createGame(1);
    const ref = createGame(1);
    for (const x of [g, ref]) x.apply({ type: 'start' });
    expect(hintCostOf(g)).toBe(POINTS.hintCost);
    const r = g.apply({ type: 'hint' });
    expect(r.ok).toBe(true);
    expect(r.hint!.cost).toBe(POINTS.hintCost);
    expect(g.state().hint).toEqual(r.hint);
    expect(hintCostOf(g)).toBe(2 * POINTS.hintCost);
    // live world untouched: same trajectory as a game that never asked
    expect(hashState(g.state())).toBe(hashState(ref.state()));
    g.runFor(3); ref.runFor(3);
    expect(hashState(g.state())).toBe(hashState(ref.state()));
    // broke: rejected with a reason, nothing charged
    const p = g.state().scoreboard.points;
    const r2 = g.apply({ type: 'hint' });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toMatch(/costs 100 points/);
    expect(g.state().scoreboard.points).toBe(p);
    // with enough points the second hint costs double
    g.state().scoreboard.pointsBy.clouds += 1000;
    g.step(1);
    const r3 = g.apply({ type: 'hint' });
    expect(r3.ok).toBe(true);
    expect(r3.hint!.cost).toBe(2 * POINTS.hintCost);
    expect(g.state().scoreboard.pointsBy.spentHints).toBe(3 * POINTS.hintCost);
  });

  it('suggests a valid, affordable placement for the most urgent goal', () => {
    for (const [L, pre] of [[1, 0], [2, 3], [3, 12]] as const) {
      const g = createGame(L, 4);
      playTimeline(g, L === 3 ? [{ t: 0, action: { type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 } }] : [], { untilSec: pre });
      const r = g.apply({ type: 'hint' });
      expect(r.ok).toBe(true);
      const h = r.hint!;
      expect(h.reason.length).toBeGreaterThan(10);
      expect(g.state().goals[h.goalIndex].met).toBe(false);
      expect(g.state().level.tools).toContain(h.tool);
      expect(g.state().energy).toBeGreaterThanOrEqual(TOOL_DEFS[h.tool].cost);
      const res = g.apply({ type: 'place', tool: h.tool, x: h.x, y: h.y, ...(h.x2 !== undefined ? { x2: h.x2, y2: h.y2 } : {}) });
      expect(`L${L}: ${res.reason ?? 'ok'}`).toBe(`L${L}: ok`);
      expect(g.state().hint).toBeNull(); // acted on
    }
  }, 30000);

  it('refuses (free of charge) when no tool is affordable', () => {
    const g = createGame(1);
    g.apply({ type: 'place', tool: 'repulsor', x: 40, y: 40 });
    g.apply({ type: 'place', tool: 'repulsor', x: 100, y: 40 });
    const r = g.apply({ type: 'hint' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/energy/);
    expect(g.state().scoreboard.points).toBe(POINTS.startPoints);
  });

  it('answers in < 300 ms on a 3000-particle level', () => {
    const g = createGame(5);
    playTimeline(g, [{ t: 0, action: { type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 } }], { untilSec: 20 });
    g.state().scoreboard.pointsBy.clouds += 10000;
    g.step(1);
    g.apply({ type: 'hint' }); // warm up
    const t = performance.now();
    const r = g.apply({ type: 'hint' });
    const ms = performance.now() - t;
    expect(g.state().particles.length).toBeGreaterThanOrEqual(2900);
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(300);
  }, 30000);
});

describe('performance', () => {
  it('steps 20 s with 3000 particles quickly', () => {
    const g = createGame(5);
    g.apply({ type: 'place', tool: 'repulsor', x: 60, y: 45 });
    const t = performance.now();
    g.runFor(20);
    expect(g.state().particles.length).toBeGreaterThanOrEqual(2900);
    expect(performance.now() - t).toBeLessThan(1500);
  }, 10000);
});

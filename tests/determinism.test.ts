import { describe, expect, it } from 'vitest';
import { cloneWorld, createGame, hashState, playTimeline, tickWorld } from '../src/sim/game.ts';
import { mulberry32 } from '../src/sim/rng.ts';
import type { TimedAction } from '../src/sim/types.ts';

const timeline: TimedAction[] = [
  { t: 0, action: { type: 'place', tool: 'repulsor', x: 62, y: 45 } },
  { t: 3, action: { type: 'place', tool: 'repulsor', x: 98, y: 45 } },
];

describe('determinism', () => {
  it('mulberry32 is reproducible and resumable from its state', () => {
    const a = mulberry32(42), b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    const c = mulberry32(a.getState());
    expect(c.next()).toBe(a.next());
  });

  it('same seed + timeline -> identical state hash', () => {
    const g1 = createGame(1, 7), g2 = createGame(1, 7);
    playTimeline(g1, timeline, { untilSec: 20 });
    playTimeline(g2, timeline, { untilSec: 20 });
    expect(hashState(g1.state())).toBe(hashState(g2.state()));
    expect(g1.state().scoreboard.points).toBe(g2.state().scoreboard.points);
  });

  it('stepping in chunks equals runFor', () => {
    const g1 = createGame(2, 3), g2 = createGame(2, 3);
    for (const g of [g1, g2]) g.apply({ type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 });
    g1.runFor(20);
    for (let i = 0; i < 600; i += 37) g2.step(Math.min(37, 600 - i));
    expect(g1.state().totalTick).toBe(600);
    expect(g1.state().time).toBe(20);
    expect(hashState(g1.state())).toBe(hashState(g2.state()));
  });

  it('a cloned world evolves exactly like the original and shares nothing with it', () => {
    const g = createGame(3, 5);
    playTimeline(g, [{ t: 0, action: { type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 } }], { untilSec: 15 });
    const c = cloneWorld(g.world());
    expect(c.s.particles[0]).not.toBe(g.state().particles[0]);
    for (let i = 0; i < 300; i++) tickWorld(c);
    g.runFor(10);
    expect(hashState(c.s)).toBe(hashState(g.state()));
    expect(c.s.scoreboard.points).toBe(g.state().scoreboard.points);
  });

  it('different seed -> different state', () => {
    expect(hashState(createGame(1, 1).state())).not.toBe(hashState(createGame(1, 2).state()));
  });

  it('restart reproduces the initial state', () => {
    const g = createGame(3);
    const h0 = hashState(g.state());
    playTimeline(g, timeline, { untilSec: 5 });
    g.apply({ type: 'restart' });
    expect(g.state().phase).toBe('intro');
    expect(hashState(g.state())).toBe(h0);
  });
});

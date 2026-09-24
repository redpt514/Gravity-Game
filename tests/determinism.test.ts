import { describe, expect, it } from 'vitest';
import { applyActions, createGame, hashState } from '../src/sim/game.ts';
import { mulberry32 } from '../src/sim/rng.ts';
import type { Action } from '../src/sim/types.ts';

const actions: Action[] = [
  { type: 'place', tool: 'repulsor', x: 62, y: 45 },
  { type: 'place', tool: 'repulsor', x: 98, y: 45 },
  { type: 'endRound' },
];

describe('determinism', () => {
  it('mulberry32 is reproducible', () => {
    const a = mulberry32(42), b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });

  it('same seed + actions -> identical state hash', () => {
    const g1 = createGame(1, 7), g2 = createGame(1, 7);
    applyActions(g1, actions);
    applyActions(g2, actions);
    expect(hashState(g1.state())).toBe(hashState(g2.state()));
    expect(g1.state().bodies.length).toBe(g2.state().bodies.length);
  });

  it('stepping in chunks equals runRound', () => {
    const g1 = createGame(2, 3), g2 = createGame(2, 3);
    for (const g of [g1, g2]) {
      g.apply({ type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 });
      g.apply({ type: 'endRound' });
    }
    g1.runRound();
    while (g2.step(37)) { /* animate */ }
    expect(hashState(g1.state())).toBe(hashState(g2.state()));
  });

  it('different seed -> different state', () => {
    const g1 = createGame(1, 1), g2 = createGame(1, 2);
    expect(hashState(g1.state())).not.toBe(hashState(g2.state()));
  });

  it('restart reproduces the initial state', () => {
    const g = createGame(3);
    const h0 = hashState(g.state());
    applyActions(g, actions);
    g.apply({ type: 'restart' });
    expect(hashState(g.state())).toBe(h0);
  });
});

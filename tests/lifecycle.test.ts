import { describe, expect, it } from 'vitest';
import { applyActions, createGame, debugSpawnBody } from '../src/sim/game.ts';
import { P } from '../src/sim/params.ts';

function running(level: number) {
  const g = createGame(level);
  g.apply({ type: 'endRound' }); // intro -> plan
  g.apply({ type: 'endRound' }); // plan -> running
  expect(g.state().phase).toBe('running');
  return g;
}

describe('lifecycle', () => {
  it('a cloud forms when gas is squeezed, not otherwise', () => {
    const idle = createGame(1);
    applyActions(idle, [{ type: 'endRound' }]);
    expect(idle.state().scoreboard.cloudsFormed).toBe(0);

    const g = createGame(1);
    applyActions(g, [
      { type: 'place', tool: 'repulsor', x: 62, y: 45 },
      { type: 'place', tool: 'repulsor', x: 98, y: 45 },
      { type: 'endRound' },
    ]);
    const s = g.state();
    expect(s.scoreboard.cloudsFormed).toBeGreaterThanOrEqual(1);
    expect(s.bodies.length).toBeGreaterThanOrEqual(1);
    // captured particles point at existing bodies and body mass equals captured count
    for (const b of s.bodies) expect(s.particles.filter((p) => p.bodyId === b.id).length).toBe(b.mass);
  });

  it('walling off the current forms a cloud within one round', () => {
    const g = createGame(2);
    applyActions(g, [{ type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 }, { type: 'endRound' }]);
    expect(g.state().scoreboard.cloudsFormed).toBeGreaterThanOrEqual(1);
  });

  it('mass thresholds: planet at 40, star ignites at 120', () => {
    const g = running(1);
    const a = debugSpawnBody(g, 'cloud', 30, 30, P.planetMass - 1);
    const b = debugSpawnBody(g, 'cloud', 80, 45, P.planetMass + 5);
    const c = debugSpawnBody(g, 'cloud', 130, 60, P.starMass);
    g.step(1);
    expect(a.kind).toBe('cloud');
    expect(b.kind).toBe('planet');
    expect(c.kind).toBe('star_ms');
    expect(g.state().scoreboard.starsByKind.star_ms).toBe(1);
    expect(g.state().log.some((l) => l.includes('ignited'))).toBe(true);
  });

  it('fusion turns H into He and counts it on the scoreboard', () => {
    const g = running(1);
    const st = debugSpawnBody(g, 'star_ms', 80, 45, 200);
    g.step(100);
    expect(st.composition.He).toBeGreaterThan(5);
    expect(g.state().scoreboard.elements.He).toBeGreaterThan(5);
    expect(st.composition.H + st.composition.He).toBeCloseTo(st.mass, 3);
  });

  it('a star low on H becomes a red giant making C and O', () => {
    const g = running(1);
    const st = debugSpawnBody(g, 'star_ms', 80, 45, 150, { H: 0.25, He: 0.75 });
    g.step(1);
    expect(st.kind).toBe('star_giant');
    g.step(50);
    expect(g.state().scoreboard.elements.C).toBeGreaterThan(0);
    expect(g.state().scoreboard.elements.O).toBeGreaterThan(0);
  });

  it('a massive giant goes supernova and ejects heavy-element gas', () => {
    const g = running(1);
    const s = g.state();
    const giant = debugSpawnBody(g, 'star_giant', 80, 45, 300, { He: 0.05, C: 0.5, O: 0.45 });
    const freeBefore = s.particles.filter((p) => p.bodyId === 0).length;
    g.step(1);
    expect(s.scoreboard.novae).toBe(1);
    expect(s.events.some((e) => e.kind === 'supernova')).toBe(true);
    expect(giant.kind).toBe('neutron');
    const ejected = s.particles.filter((p) => p.bodyId === 0).length - freeBefore;
    expect(ejected).toBeGreaterThan(150);
    const els = new Set(s.particles.filter((p) => p.bodyId === 0 && p.el !== 'H').map((p) => p.el));
    expect(els.has('Fe')).toBe(true);
    expect(els.has('C') || els.has('O')).toBe(true);
    expect(s.scoreboard.elements.Fe).toBeGreaterThan(0);
  });

  it('a light giant fades to a white dwarf', () => {
    const g = running(1);
    const giant = debugSpawnBody(g, 'star_giant', 80, 45, 150, { He: 0.05, C: 0.5, O: 0.45 });
    g.step(1);
    expect(giant.kind).toBe('white_dwarf');
    expect(g.state().scoreboard.novae).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { createGame, debugSpawnBody, playTimeline } from '../src/sim/game.ts';
import { P, POINTS } from '../src/sim/params.ts';

function playing(level: number) {
  const g = createGame(level);
  g.apply({ type: 'start' });
  expect(g.state().phase).toBe('playing');
  return g;
}

describe('lifecycle', () => {
  it('a cloud forms when gas is squeezed, not otherwise', () => {
    const idle = playing(1);
    idle.runFor(20);
    expect(idle.state().scoreboard.cloudsFormed).toBe(0);

    const g = createGame(1);
    playTimeline(g, [
      { t: 0, action: { type: 'place', tool: 'repulsor', x: 62, y: 45 } },
      { t: 0, action: { type: 'place', tool: 'repulsor', x: 98, y: 45 } },
    ], { untilSec: 20 });
    const s = g.state();
    expect(s.scoreboard.cloudsFormed).toBeGreaterThanOrEqual(1);
    for (const b of s.bodies) expect(s.particles.filter((p) => p.bodyId === b.id).length).toBe(b.mass);
  });

  it('walling off the current forms a cloud within 20 s', () => {
    const g = createGame(2);
    playTimeline(g, [{ t: 0, action: { type: 'place', tool: 'wall', x: 80, y: 0, x2: 80, y2: 45 } }], { untilSec: 20 });
    expect(g.state().scoreboard.cloudsFormed).toBeGreaterThanOrEqual(1);
  });

  it('mass thresholds: planet at 40, star ignites at 120; each formation scores', () => {
    const g = playing(1);
    const a = debugSpawnBody(g, 'cloud', 30, 30, P.planetMass - 1);
    const b = debugSpawnBody(g, 'cloud', 80, 45, P.planetMass + 5);
    const c = debugSpawnBody(g, 'cloud', 130, 60, P.starMass);
    g.step(1);
    expect(a.kind).toBe('cloud');
    expect(b.kind).toBe('planet');
    expect(c.kind).toBe('star_ms');
    const sb = g.state().scoreboard;
    expect(sb.starsByKind.star_ms).toBe(1);
    expect(sb.pointsBy.planets).toBe(POINTS.planet);
    expect(sb.pointsBy.stars).toBe(POINTS.star_ms);
    expect(g.state().log.some((l) => l.includes('ignited'))).toBe(true);
  });

  it('fusion turns H into He, counts it and pays per unit', () => {
    const g = playing(1);
    const st = debugSpawnBody(g, 'star_ms', 80, 45, 200);
    g.step(100);
    const sb = g.state().scoreboard;
    expect(st.composition.He).toBeGreaterThan(5);
    expect(sb.elements.He).toBeGreaterThan(5);
    expect(st.composition.H + st.composition.He).toBeCloseTo(st.mass, 3);
    expect(sb.pointsBy.elements).toBe(Math.floor(sb.elements.He * POINTS.element.He));
  });

  it('a star low on H becomes a red giant making C and O', () => {
    const g = playing(1);
    const st = debugSpawnBody(g, 'star_ms', 80, 45, 150, { H: 0.25, He: 0.75 });
    g.step(1);
    expect(st.kind).toBe('star_giant');
    expect(g.state().scoreboard.pointsBy.stars).toBe(POINTS.star_giant);
    g.step(50);
    expect(g.state().scoreboard.elements.C).toBeGreaterThan(0);
    expect(g.state().scoreboard.elements.O).toBeGreaterThan(0);
  });

  it('a massive giant goes supernova, ejects heavy-element gas and scores nova + neutron star', () => {
    const g = playing(1);
    const s = g.state();
    const giant = debugSpawnBody(g, 'star_giant', 80, 45, 300, { He: 0.05, C: 0.5, O: 0.45 });
    const freeBefore = s.particles.filter((p) => p.bodyId === 0).length;
    g.step(1);
    expect(s.scoreboard.novae).toBe(1);
    expect(s.events.some((e) => e.kind === 'supernova' && s.time - e.t < 0.1)).toBe(true);
    expect(giant.kind).toBe('neutron');
    expect(s.scoreboard.pointsBy.novae).toBe(POINTS.supernova);
    expect(s.scoreboard.pointsBy.stars).toBe(POINTS.neutron);
    expect(s.particles.filter((p) => p.bodyId === 0).length - freeBefore).toBeGreaterThan(150);
    const els = new Set(s.particles.filter((p) => p.bodyId === 0 && p.el !== 'H').map((p) => p.el));
    expect(els.has('Fe')).toBe(true);
    expect(s.scoreboard.elements.Fe).toBeGreaterThan(0);
    expect(s.scoreboard.pointsBy.elements).toBeGreaterThanOrEqual(s.scoreboard.elements.Fe * POINTS.element.Fe);
    // events fade after a few seconds
    g.runFor(P.eventKeepSec + 1);
    expect(s.events.length).toBe(0);
  });

  it('a light giant fades to a white dwarf', () => {
    const g = playing(1);
    const giant = debugSpawnBody(g, 'star_giant', 80, 45, 150, { He: 0.05, C: 0.5, O: 0.45 });
    g.step(1);
    expect(giant.kind).toBe('white_dwarf');
    expect(g.state().scoreboard.novae).toBe(0);
  });
});

describe('lifecycle fixes', () => {
  it('a neutron star is not swallowed by a bigger main-sequence star; past its limit it collapses', () => {
    const g = playing(1);
    const n = debugSpawnBody(g, 'neutron', 80, 45, 120);
    debugSpawnBody(g, 'star_ms', 81, 45, 150);
    g.step(1);
    const s = g.state();
    expect(s.bodies.some((b) => b.kind === 'star_ms')).toBe(false);
    expect(s.bodies.find((b) => b.mass >= 270)!.kind).toBe('black_hole');
    expect(s.bodies.some((b) => b.id === n.id) || s.bodies.length === 1).toBe(true);
  });

  it('a neutron star does not accrete gas', () => {
    const g = playing(1);
    const n = debugSpawnBody(g, 'neutron', 80, 45, 100);
    g.step(200);
    expect(n.mass).toBe(100);
  });

  it('new clouds are born at most cloudMaxBirthMass', () => {
    const g = playing(4);
    g.apply({ type: 'place', tool: 'pulse', x: 80, y: 45 });
    const born: number[] = [];
    for (let i = 0; i < 300; i++) { const before = new Set(g.state().bodies.map((b) => b.id)); g.step(1); for (const b of g.state().bodies) if (!before.has(b.id)) born.push(b.mass); }
    for (const m of born) expect(m).toBeLessThanOrEqual(P.cloudMaxBirthMass);
  });

  it('bodies do not stick to the board edge', () => {
    const g = playing(1);
    const b = debugSpawnBody(g, 'planet', 158, 2, 60);
    g.step(120);
    expect(b.x < 150 || b.y > 10).toBe(true);
  });
});

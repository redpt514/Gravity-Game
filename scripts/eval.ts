/**
 * Balance harness: npm run eval [-- --only lens,pulse,sol,idle,up]
 * lens: lone lens at centre on L3-L5 seeds 1-3 (must lose); pulse: all energy on random pulses every round,
 * L4/L5 x 20 seeds (target < 20% wins); sol: tests/solutions.ts on seeds 1-8; idle: place-nothing on seeds 1-8.
 */
import { applyActions, createGame } from '../src/sim/game.ts';
import { mulberry32 } from '../src/sim/rng.ts';
import { TOOL_DEFS } from '../src/sim/tools.ts';
import type { Game } from '../src/sim/types.ts';
import { SOLUTIONS, replay } from '../tests/solutions.ts';

const argv = process.argv.slice(2);
const only = (argv[argv.indexOf('--only') + 1] ?? '').split(',').filter(Boolean);
const want = (k: string) => !argv.includes('--only') || only.includes(k);
const levels = argv.includes('--levels') ? argv[argv.indexOf('--levels') + 1].split(',').map(Number) : [1, 2, 3, 4, 5];

function play(level: number, seed: number, perRound: (g: Game, round: number) => void): { phase: string; round: number; energy: number; log: string } {
  const g = createGame(level, seed);
  g.apply({ type: 'start' });
  while (g.state().phase === 'plan') {
    perRound(g, g.state().round);
    applyActions(g, [{ type: 'endRound' }]);
    if (g.state().phase === 'roundEnd') g.apply({ type: 'start' });
  }
  const s = g.state();
  return { phase: s.phase, round: s.round, energy: s.energy, log: s.log.slice(-2).join(' | ') };
}

if (want('lens')) for (const L of [3, 4, 5]) for (const seed of [1, 2, 3]) {
  const r = play(L, seed, (g, rd) => { if (rd === 1) g.apply({ type: 'place', tool: 'lens', x: 80, y: 45 }); });
  console.log(`lens L${L} s${seed}: ${r.phase} R${r.round}`);
}
if (want('pulse')) for (const L of [4, 5]) {
  let wins = 0; const rounds: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const rng = mulberry32(seed * 977);
    const r = play(L, seed, (g) => {
      let k = 0;
      while (g.state().energy >= TOOL_DEFS.pulse.cost && k++ < 20) g.apply({ type: 'place', tool: 'pulse', x: 5 + rng.next() * 150, y: 5 + rng.next() * 80 });
    });
    if (r.phase === 'won') { wins++; rounds.push(r.round); }
  }
  console.log(`pulse-spam L${L}: ${wins}/20 wins (rounds ${rounds.join(',')})`);
}
if (want('sol')) for (const sol of SOLUTIONS) {
  if (!levels.includes(sol.level)) continue;
  const res: string[] = [];
  for (let seed = 1; seed <= 8; seed++) {
    const g = createGame(sol.level, seed);
    replay(g, sol.actions);
    const s = g.state();
    res.push(`${s.phase === 'won' ? 'W' : 'L'}${s.round}`);
  }
  const g = createGame(sol.level); replay(g, sol.actions);
  console.log(`sol L${sol.level}: ${res.join(' ')} | default: ${g.state().phase} R${g.state().round} E${g.state().energy} score ${g.state().scoreboard.score}`);
}
if (want('idle')) for (const L of levels) {
  const res: string[] = [];
  for (let seed = 1; seed <= 8; seed++) res.push(play(L, seed, () => {}).phase[0]);
  console.log(`idle L${L}: ${res.join('')}`);
}

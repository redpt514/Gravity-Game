/**
 * Balance harness: npm run eval [-- --only sol,idle,lens,pulse] [--levels 1,2,3]
 * sol: tests/solutions.ts timelines on seeds 1-8 (time each goal was met, points at clear);
 * idle: place-nothing on seeds 1-8 (goals met before their deadline, should be none);
 * lens: lone lens at the centre on L3-L5 seeds 1-3 (should not clear in time);
 * pulse: all energy on random pulses every 10 s, L4/L5 x 10 seeds (should rarely clear in time).
 */
import { createGame, playTimeline } from '../src/sim/game.ts';
import { mulberry32 } from '../src/sim/rng.ts';
import { TOOL_DEFS } from '../src/sim/tools.ts';
import type { Game, TimedAction } from '../src/sim/types.ts';
import { SOLUTIONS, replay } from '../tests/solutions.ts';

const argv = process.argv.slice(2);
const only = (argv[argv.indexOf('--only') + 1] ?? '').split(',').filter(Boolean);
const want = (k: string) => !argv.includes('--only') || only.includes(k);
const levels = argv.includes('--levels') ? argv[argv.indexOf('--levels') + 1].split(',').map(Number) : [1, 2, 3, 4, 5];
const lastDeadline = (g: Game) => Math.max(...g.state().level.goals.map((x) => x.deadlineSec));
const inTime = (g: Game) => g.state().goals.filter((x) => x.met && !x.missed).length;
const met = (g: Game) => g.state().goals.map((x) => (x.metAt !== undefined ? x.metAt.toFixed(0) : 'X')).join('/');

if (want('sol')) for (const sol of SOLUTIONS) {
  if (!levels.includes(sol.level)) continue;
  const res: string[] = [];
  for (let seed = 1; seed <= 8; seed++) {
    const g = createGame(sol.level, seed);
    replay(g, sol.timeline);
    res.push(`${g.state().phase === 'cleared' ? 'C' : '-'}${met(g)}:${g.state().scoreboard.points}`);
  }
  console.log(`sol L${sol.level} (deadlines ${createGame(sol.level).state().level.goals.map((x) => x.deadlineSec).join('/')}): ${res.join(' ')}`);
}
if (want('idle')) for (const L of levels) {
  const res: string[] = [];
  for (let seed = 1; seed <= 8; seed++) { const g = createGame(L, seed); playTimeline(g, [], { untilSec: lastDeadline(g) }); res.push(String(inTime(g))); }
  console.log(`idle L${L}: goals met in time per seed ${res.join(' ')}`);
}
if (want('lens')) for (const L of [3, 4, 5]) for (const seed of [1, 2, 3]) {
  const g = createGame(L, seed);
  playTimeline(g, [{ t: 0, action: { type: 'place', tool: 'lens', x: 80, y: 45 } }], { untilSec: lastDeadline(g), stopWhenCleared: true });
  console.log(`lens L${L} s${seed}: ${g.state().phase} ${met(g)}`);
}
if (want('pulse')) for (const L of [4, 5]) {
  let wins = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const rng = mulberry32(seed * 977);
    const g = createGame(L, seed);
    const tl: TimedAction[] = [];
    for (let t = 0; t < lastDeadline(g); t += 10) for (let k = 0; k < 3; k++) tl.push({ t, action: { type: 'place', tool: 'pulse', x: 5 + rng.next() * 150, y: 5 + rng.next() * 80 } });
    void TOOL_DEFS;
    playTimeline(g, tl, { untilSec: lastDeadline(g), stopWhenCleared: true });
    if (g.state().phase === 'cleared' && inTime(g) === g.state().goals.length) wins++;
  }
  console.log(`pulse-spam L${L}: ${wins}/10 cleared in time`);
}

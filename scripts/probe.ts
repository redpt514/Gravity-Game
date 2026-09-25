// dev probe: node --experimental-strip-types scripts/probe.ts L seeds 'json TimedAction[]' [seconds]
// prints the biggest bodies and element totals every 10 s for each seed.
import { createGame, playTimeline } from '../src/sim/game.ts';
import type { TimedAction } from '../src/sim/types.ts';
const [L, seedsS, plan, secS] = process.argv.slice(2);
const timeline: TimedAction[] = JSON.parse(plan ?? '[]');
const until = Number(secS ?? 60);
for (const seed of seedsS.split(',').map(Number)) {
  const g = createGame(Number(L), seed);
  const out: string[] = [];
  for (let t = 10; t <= until; t += 10) {
    const rs = playTimeline(g, timeline.filter((a) => a.t >= t - 10 && a.t < t).map((a) => ({ ...a })), { untilSec: t });
    const bad = rs.filter((r) => !r.ok).map((r) => r.reason);
    const s = g.state();
    const bs = [...s.bodies].sort((a, b) => b.mass - a.mass).slice(0, 3).map((b) => `${b.kind[0]}${Math.round(b.mass)}@${Math.round(b.x)},${Math.round(b.y)}`).join(' ');
    out.push(`${t}s[${bs}] He${Math.floor(s.scoreboard.elements.He)} CO${Math.floor(s.scoreboard.elements.C + s.scoreboard.elements.O)} nov${s.scoreboard.novae} pts${s.scoreboard.points}${bad.length ? ' ERR ' + bad.join(',') : ''}`);
  }
  console.log(`s${seed} ${g.state().phase} ${g.state().goals.map((x) => (x.metAt !== undefined ? x.metAt.toFixed(0) : 'X')).join('/')}: ${out.join(' | ')}`);
}

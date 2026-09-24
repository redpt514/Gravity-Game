// dev probe: node --experimental-strip-types scripts/probe.ts L seeds 'json actions per round' (array of arrays)
import { applyActions, createGame } from '../src/sim/game.ts';
import type { Action } from '../src/sim/types.ts';
const [L, seedsS, plan] = process.argv.slice(2);
const rounds: Action[][] = JSON.parse(plan);
for (const seed of seedsS.split(',').map(Number)) {
  const g = createGame(Number(L), seed);
  const out: string[] = [];
  for (const acts of rounds) {
    if (g.state().phase === 'won' || g.state().phase === 'lost') break;
    const rs = applyActions(g, [...acts, { type: 'endRound' }]);
    const bad = rs.filter((r) => !r.ok).map((r) => r.reason);
    const s = g.state();
    const bs = [...s.bodies].sort((a, b) => b.mass - a.mass).slice(0, 3).map((b) => `${b.kind[0]}${Math.round(b.mass)}@${Math.round(b.x)},${Math.round(b.y)}`).join(' ');
    out.push(`R${s.round}[${bs}] He${Math.floor(s.scoreboard.elements.He)} CO${Math.floor(s.scoreboard.elements.C + s.scoreboard.elements.O)} nov${s.scoreboard.novae} n${s.bodies.length}${bad.length ? ' ERR ' + bad.join(',') : ''}`);
  }
  console.log(`s${seed} ${g.state().phase}: ${out.join(' | ')}`);
}

# Gravity Game — Project Plan (v0.2: adaptive board, procedural levels 4+)

## Pitch
Reverse tower defense in a galaxy nursery. A gently pulsing gravity landscape is
littered with particles. The player spends **dark energy** to place **anti-gravity
nodes** that squeeze particles into the remaining space. Density begets gravity:
clouds → planets → stars → fusion → supernovae, which scatter heavier elements the
player then herds again. Each **round** pays out dark-energy income; each level sets
goals per round ("2 clouds by round 2", "40 helium by round 4") and builds on the last.

## Platforms
Web first (Vite + TypeScript, WebGL2 + Canvas, no game framework). Mobile via
Capacitor wrapper (iOS/Android) once the web loop is proven. All input is
pointer-based (tap/drag), portrait-safe layout, 60 fps target on mid phones:
sim is grid-field based, not N-body.

## Architecture
```
src/sim      pure TS, deterministic, no DOM. Game interface in types.ts (the contract)
src/levels   handcrafted levels 1–3, goal evaluation, procedural generator + calibration bot (4+), catalog, worker
src/render   WebGL2 background shader (pulsing gravity field), particle + body renderer
src/ui       HUD (energy, round, goals), tool palette, scoreboard, intro/round-end cards
scripts/     play.ts — headless CLI (JSON lines) so agents/tests can play levels
tests/       vitest: determinism, lifecycle thresholds, level solvability (scripted)
```
Contract: `src/sim/types.ts`. UI only reads `GameState` and calls `Game.apply/step`.

## Simulation model (mobile-cheap; numbers live in `src/sim/params.ts`)
- **Adaptive board**: `createGame(level, seed, { world })` takes the board size from `worldSizeForAspect(aspect)`
  (`src/sim/worldSize.ts`): area fixed at 160×90 = 14400 units², 2.5-unit cells, aspect quantized to 0.1 in
  [0.55, 2.4], so particle density and difficulty stay comparable. Default (tests, scripted solutions) is the legacy
  160×90 board with a 64×36 grid. All sim code reads `state.width/height/gridW/gridH`; spawn, ambient pull, current
  and edges scale with the board. Thresholds scale with the level's mean density ρ̄ = particles / cells.
- On tall boards the current is scaled by width/height so its fastest edge (the sides) matches a wide board's top.
  No cloud condenses in a level's first 15 ticks (random spawn clumps are not clouds).
- `forceAt(state, x, y)` (`src/sim/force.ts`) is the acceleration a free particle feels (gas potential gradient incl.
  ambient, bodies, nodes, pressure; current; edge spring). The particle integrator uses the same function.
- **Gas current**: divergence-free counter-clockwise ellipse around the centre (top flows left, right flows up),
  fading toward the corners. Obstacles dam it: gas piles up on the *upstream* side.
- `field = ambient(centre pull, pulsing, ripples) + G·blur(gas above 1.9ρ̄ + 0.1·body mass) + Σ node kernels`.
  Bodies move along ∇field; free gas moves along ∇(field − pressure) but feels only **15% of lens kernels**.
- Cloud forms where smoothed **free-gas** density ≥ 2.4ρ̄ (the `cloudThreshold`), at least 7 + r from any body and
  **never inside a lens radius**. A new cloud takes at most the **30 nearest** particles (≥14 needed); the rest must be accreted.
- Accretion rate per tick = (0.02 + 0.00015·m) × feed, feed = local free-gas density / threshold clamped to [0.1, 6]
  (the body's own mass is not counted), ×1.8 and +1.5 radius inside a lens. So herding gas into a body in later rounds
  grows it faster (L3: a round-2 repulsor upstream of the pile ≈ +50–80% mass).
- Mass ladder: cloud → planet (m≥40) → star_ms (m≥120). star_ms fuses H→He at 2.2e-6·m²/tick; H < 30% → red giant
  (He→C/O, 2.5× rate); out of He: m<250 → white dwarf, m≥250 → **supernova** (ejects 60% as gas incl. 15% Fe, 5% heavy;
  leaves a neutron star). White dwarf fed to 320 → type Ia supernova. Neutron stars do not accrete; merged past 200 → black hole.
  Any body ≥600 → black hole. In merges remnants dominate (black hole > neutron > white dwarf), otherwise the later stage wins.
- Bodies drift with the current (never less than 50% of it, so none strand in corners) and are pushed off the edges softly.
- Placement: walls need x2,y2 and length 5–50; same-tool nodes (wall midpoints) must be ≥4 apart; rejections carry a reason.
- Costs: repulsor 30 (r16), wall 35, lens 80 (r18), pulse 40 (r20, one round). Score = 10/cloud + 50/star + 200/nova
  + 1/element produced + **1/unspent energy on win**.
- Scoreboard counts formations, novae, elements *produced* (fusion/nova output).

## Round loop (reverse TD)
`intro → plan (place nodes, spend energy) → running (ticksPerRound) → roundEnd (goals w/ byRound
checked; income paid) → plan … → won/lost`. Losing a goal by its round = level lost, restart.

During plan, nodes placed this round can be dragged to move them for free or tapped to remove them for a full
refund. Nodes from earlier rounds are locked in place and can only be removed, with no refund.

## Levels
**Progression**: levels 1–3 are handcrafted (below); 4+ are procedural (`src/levels/procgen.ts`), generated per board
size and cached by `levelCacheKey(n, world)` (`src/levels/catalog.ts`: `getLevelDef(n, world)`; the UI generates them
in `procgen.worker.ts`). Handcrafted 4–5 below stay in `LEVELS` for tests/eval but are no longer in the progression.

**Generator** (deterministic in (n, world), ~3.5–4.5 s in node): difficulty ramps with n — rounds 4→7, energy
105/+55 → 75/+35, current 1.0→1.5× with clockwise flips from L6, 2700→3400 particles, helium-rich gas from L6.
Goals unlock by tier: L4–5 stars + He; L6–7 C+O / red giants; L8+ supernovae, white dwarfs, iron, mixed (3 goals from
L10), always plus an early "clouds by round 2–3" goal. Palette: repulsor/wall/lens/pulse, red matter from L8, black hole
from L11; rewards every few levels. Names/intros from word lists.

**Calibration** (always winnable): the heuristic bot (`src/levels/bot.ts`) plays the rolled level with 3 strategy
variants (`single` dam→squeeze→lens line, `twin` two dams, `pinch` L1-style), screened after 2 rounds, best continued.
It plans in a canonical frame (long edge, current direction), so it works on tall/wide boards and reversed currents.
Per-round metrics are sampled exactly where the game evaluates goals; each goal = 80→90% of the bot's best (by n),
due the round the bot reached it (+1 on L4–5), and the level is trimmed to the last goal's round. Goals do not affect
the sim, so the bot's action line (`level.solution`, `npm run play -- --level N --aspect A --solution`) provably wins;
place-nothing is verified to lose by a real run (else goals tighten to 100%, then the seed is re-rolled).
`tests/procgen-*.test.ts`: L4–8 at aspects 1.8 and 0.6 won by the line, lost idle, < 8 s each.

### Handcrafted levels (reference lines in `tests/solutions.ts`, balance checks in `tests/balance.test.ts`)
| # | Name | New idea | Goals (by round) | Rounds | Energy (start/+income) | Reference line → win round |
|---|------|----------|------------------|--------|------|------|
| 1 | First Light | repulsor, density | 1 cloud r2 | 2 | 70/+30 | repulsors (80,22)+(80,68) → R1 |
| 2 | Nursery | wall, damming | 2 clouds r2, 2 planets r3 | 3 | 70/+40 | walls x=80 top+bottom → R2–R3 |
| 3 | Ignition | density-fed growth → star | 1 star r3 | 3 | 90/+50 | top wall; R2 repulsor (105,15) squeezes pile → R2–R3 |
| 4 | Forge | lens feeds a star, fusion | 1 star r3, 120 He r4 | 4 | 100/+50 | L3 line; R3 lens on the star → R4 |
| 5 | Nova | red giants, supernova | 100 C+O r5, 1 nova r5; reward: black_hole ×1 | 5 | 100/+60 | same line → R4 |

Checks (seeds 1–8 unless noted): reference lines win all; place-nothing loses all; a lone centre lens loses L3–L5
(seeds 1–3); all-energy random pulses win L4 1/20, L5 2/20 (`npm run eval`).
Reward tools land in the won state's `inventory`; pass them on with `createGame(level, seed, { inventory })`.

## Milestones (this session)
1. **M1 sim + levels + CLI** (Opus agent) — `npm test`, `npm run play -- --level 1 --auto`.
2. **M2 render + UI** (Sonnet agent) — `npm run dev` playable in browser, touch OK.
3. **M3 playtest** (2× Opus player-agents via CLI + code read) → `docs/playtest/*.md`, harsh.
4. **M4 refine** one pass on top critiques → commit. **PAUSE for human review.**

## Later (not this session)
Tool economy/meta-progression, Capacitor build, audio, saves, leaderboards; a smarter calibration bot
(lookahead per round) so late procedural levels demand more than the reference line.

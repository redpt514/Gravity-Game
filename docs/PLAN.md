# Gravity Game — Project Plan (v0.3: continuous play, countdown goals, points, hints)

## Pitch
Reverse tower defense in a galaxy nursery. A gently pulsing gravity landscape is
littered with particles. The player spends **dark energy** to place **anti-gravity
nodes** that squeeze particles into the remaining space. Density begets gravity:
clouds → planets → stars → fusion → supernovae, which scatter heavier elements the
player then herds again. The grid never stops: dark energy trickles in continuously, each goal has its own
**countdown** ("2 clouds within 25 s", "120 helium within 75 s"), and everything the player creates scores **points**,
which can be spent on **hints**.

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
src/ui       HUD (energy, clock, goal countdowns, points, hint), tool palette, intro/cleared cards
scripts/     play.ts — headless CLI (JSON lines) so agents/tests can play levels
tests/       vitest: determinism, lifecycle thresholds, level solvability (scripted)
```
Contract: `src/sim/types.ts`. UI only reads `GameState` and calls `Game.apply/step/runFor`.

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
- Costs: repulsor 30 (r16), wall 35, lens 80 (r18), pulse 40 (r20, fades out over 20 s).
- Scoreboard counts formations, novae, elements *produced* (fusion/nova output), and points (below).

## Continuous loop
`intro (paused) → playing → cleared`. The clock (`state.time`, 30 ticks/s) starts with `start` or the first
place/remove/move/hint. `step(n)`/`runFor(sec)` always advance while playing or cleared; the UI pauses by not stepping.
- Energy accrues `level.incomePerSec` every tick (fractional inside, show `floor`).
- Place/remove/move/hint any time. A node can be moved, or removed for a full refund, within `GRACE_SEC` (5 s) of
  `placedAt`; afterwards it is locked and removal refunds nothing. Pulses vanish at `expiresAt`.
- Each `GoalStatus` counts down from `deadlineSec`. Met goals latch (`metAt`, countdown frozen). At 0 an unmet goal is
  `missed` (logged) but can still be met. All met → `cleared`, `stars = 3 − missed` (min 1), rewards go to the
  inventory, and **the grid keeps running** (points keep coming) until the player moves on. There is no loss state.
- `playTimeline(game, TimedAction[], { untilSec, stopWhenCleared })` (src/sim/game.ts) replays scripted lines.

## Points (`POINTS` in src/sim/params.ts, listed in `help()`)
Live, on formation events: cloud 20, planet 40, star 100, red giant 150, white dwarf 200, neutron star 250,
black hole 400, supernova 500 (relabelling by a merge does not score). Per unit of element produced: He 1, C/O 2,
Fe 5, heavy 10. Goal met: `goal.points × (1 + remaining/deadline)` (a missed goal pays the base only).
`pointsBy` keeps the breakdown; `points = 50 (start float) + Σ pointsBy − spentHints`, never negative.
Typical: L1 cleared ≈ 250–350, L2 ≈ 600, L3 ≈ 600 at the clear (then it keeps growing while the star burns);
procedural L4 ≈ 1.5k, L8 ≈ 4.5k, L12 ≈ 7k at the clear.

## Hints (src/sim/hint.ts)
`apply({type:'hint'})` costs `50 × (1 + hints used this level)`; every level starts with 50 points so the first
hint is affordable before anything forms. Rejected, free of charge, with a reason when points are short, no tool is
affordable, or all goals are met. The engine takes the most urgent unmet goal (least time left per unit of progress
still needed), builds up to 4 candidate placements from heuristics in the canonical frame (dam the current just past
the biggest body, squeeze gas into it from upstream, lens the body nearest its next mass threshold, pinch the current,
block the densest stream, pulse beside the body, red matter on a cloud), keeps only tools usable right now, and plays
each forward on a deep clone of the world (`cloneWorld`: exact, shares nothing) for ~240 ticks in total (scaled by
particle count), then returns the one that most improves a continuous progress measure of that goal, with a
one-sentence reason. ~250 ms in node on a 3000-particle level; the live world is untouched. Stored in `state.hint`
(cleared when the player places that tool or the goal is met).

## Levels
**Progression**: levels 1–3 are handcrafted (below); 4+ are procedural (`src/levels/procgen.ts`), generated per board
size and cached by `levelCacheKey(n, world)` (`src/levels/catalog.ts`: `getLevelDef(n, world)`; the UI generates them
in `procgen.worker.ts`). Handcrafted 4–5 below stay in `LEVELS` for tests/eval but are no longer in the progression.

**Generator** (deterministic in (n, world), ~4.5–5.5 s in node for n ≤ 12): difficulty ramps with n — calibration
horizon 80→110 s, energy 105 +2.75/s → 75 +1.75/s, current 1.0→1.5× with clockwise flips from L6, 2700→3400
particles, helium-rich gas from L6. Goals unlock by tier: L4–5 stars + He; L6–7 C+O / red giants; L8+ supernovae,
white dwarfs, iron, mixed (3 goals from L10), always plus an early clouds goal (what the bot had at 30 s). Palette: repulsor/wall/lens/pulse, red matter from L8, black hole
from L11; rewards every few levels. Names/intros from word lists.

**Calibration** (always clearable): the heuristic bot (`src/levels/bot.ts`) plays the rolled level on the clock,
acting every 10 s (≤ 3 placements, items unlock at 20 s "round" steps), with 3 strategy variants (`single`
dam→squeeze→lens line, `twin` two dams, `pinch` L1-style), screened after 30 s, best continued to the horizon.
It plans in a canonical frame (`src/sim/frame.ts`: long edge, current direction), so it works on tall/wide boards and
reversed currents. Metrics are sampled every second; each goal = 80→90% of the bot's best (by n), with
`deadlineSec` = when the bot got there × (1.3 on L4–5, 1.2 to L8, 1.15 after) + 10/5 s, rounded up to 5 s; goal
points 100–500 by type × (1 + 0.1(n−4)). Goals do not affect the sim, so the bot's `TimedAction[]`
(`level.solution`, `npm run play -- --level N --aspect A --solution`) provably clears with 3 stars.
Place-nothing is verified to miss every goal by a real idle run (cut at 45 s if the board is still empty, since an
empty board then cannot reach the later star/element goals in time); else goals tighten to 100%, then re-roll.
`tests/procgen-*.test.ts`: L4–8 at aspects 1.8 and 0.6 cleared by the timeline, idle misses everything.

### Handcrafted levels (reference timelines in `tests/solutions.ts`, balance checks in `tests/balance.test.ts`)
| # | Name | New idea | Goals (deadline, points) | Energy (start/+per s) | Reference timeline → goals met at |
|---|------|----------|------------------|------|------|
| 1 | First Light | repulsor, density | 1 cloud 25 s (100) | 70/+1.5 | t0 repulsors (80,22)+(80,68) → 1–15 s |
| 2 | Nursery | wall, damming | 2 clouds 25 s (100), 2 planets 55 s (150) | 70/+2 | t0 walls x=80 top+bottom → ~11 s / 35–42 s |
| 3 | Ignition | density-fed growth → star | 1 star 60 s (250) | 90/+2.5 | t0 top wall; t15 repulsor (105,15) → 27–45 s |
| 4 | Forge | lens feeds a star, fusion | 1 star 55 s, 120 He 75 s | 100/+2.5 | L3 line; t35 lens (90,22) |
| 5 | Nova | red giants, supernova | 100 C+O 95 s, 1 nova 95 s; reward: black_hole ×1 | 100/+3 | same line |

Deadlines ≈ former rounds × 20 s, tuned so the reference line (placed at once) clears with ~25–45% of the time left
and place-nothing misses every goal on seeds 1–8 (idle forms its first cloud only after ~100 s). L4–5 stay in
`LEVELS` for tests/eval but are no longer in the progression and were not re-tuned. `npm run eval` prints met times,
points, idle, lone-lens and pulse-spam checks. Reward tools land in the cleared state's `inventory`; pass them on with
`createGame(level, seed, { inventory })`.

### CLI (`scripts/play.ts`)
JSON lines: any Action (incl. `{"type":"hint"}`), `{"type":"advance","seconds":N}`, `{"type":"state"}`, `{"type":"help"}`,
`{"type":"ascii"}`. The state summary has time, energy, goals (remainingSec/met/metAt/missed), points + breakdown,
next hint cost, current hint, stars. `--auto` plays the calibration bot's timeline; `--solution` the reference one.

## Milestones (this session)
1. **M1 sim + levels + CLI** (Opus agent) — `npm test`, `npm run play -- --level 1 --auto`.
2. **M2 render + UI** (Sonnet agent) — `npm run dev` playable in browser, touch OK.
3. **M3 playtest** (2× Opus player-agents via CLI + code read) → `docs/playtest/*.md`, harsh.
4. **M4 refine** one pass on top critiques → commit. **PAUSE for human review.**

## Later (not this session)
Tool economy/meta-progression, Capacitor build, audio, saves, leaderboards; a smarter calibration bot
(lookahead per round) so late procedural levels demand more than the reference line.

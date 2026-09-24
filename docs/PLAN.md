# Gravity Game — Project Plan (v0.1, levels 1–5 prototype)

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
src/levels   data for levels 1–5, goal evaluation
src/render   WebGL2 background shader (pulsing gravity field), particle + body renderer
src/ui       HUD (energy, round, goals), tool palette, scoreboard, intro/round-end cards
scripts/     play.ts — headless CLI (JSON lines) so agents/tests can play levels
tests/       vitest: determinism, lifecycle thresholds, level solvability (scripted)
```
Contract: `src/sim/types.ts`. UI only reads `GameState` and calls `Game.apply/step`.

## Simulation model (mobile-cheap)
- Board 160×90 world units; 64×36 potential grid `field`.
- `field = ambient(center pull, pulsing) + Σ particle/body mass splat (blurred) + Σ node kernels`.
- Free particles accelerate along −∇field (toward high pull), damped; nodes add repel/attract kernels.
- Cell density > τ_cloud over a neighborhood → spawn **cloud** body capturing those particles.
- Bodies accrete free particles within radius; mass thresholds: cloud → planet (m≥40) → star_ms (m≥120).
- star_ms fuses H→He at rate ∝ mass; when H fraction < 30% → star_giant (He→C/O).
  Giant m<250 → white_dwarf; m≥250 → **supernova**: ejects 60% of mass as free particles
  (C/O/Fe/heavy mix), leaves neutron. Bodies with m≥600 collapse → black_hole.
- Scoreboard counts formations, novae, elements *produced* (fusion/nova output).

## Round loop (reverse TD)
`intro → plan (place nodes, spend energy) → running (ticksPerRound) → roundEnd (goals w/ byRound
checked; income paid) → plan … → won/lost`. Losing a goal by its round = level lost, restart.

## Levels 1–5 (prototype scope)
| # | Name | New idea | Goals (by round) | Rounds |
|---|------|----------|------------------|--------|
| 1 | First Light | repulsor, density | 1 cloud by r2 | 2 |
| 2 | Nursery | wall, accretion | 2 clouds r2, 1 planet r3 | 3 |
| 3 | Ignition | mass → star | 1 star r3 | 3 |
| 4 | Forge | pulse, fusion timers | 1 star r2, 40 He r4 | 4 |
| 5 | Nova | red giants, supernova | 1 nova r4, 20 C+O r5; reward: black_hole ×1 | 5 |

## Milestones (this session)
1. **M1 sim + levels + CLI** (Opus agent) — `npm test`, `npm run play -- --level 1 --auto`.
2. **M2 render + UI** (Sonnet agent) — `npm run dev` playable in browser, touch OK.
3. **M3 playtest** (2× Opus player-agents via CLI + code read) → `docs/playtest/*.md`, harsh.
4. **M4 refine** one pass on top critiques → commit. **PAUSE for human review.**

## Later (not this session)
Levels 6+, tool economy/meta-progression, Capacitor build, audio, saves, leaderboards,
procedural level generator (levels 1–5 are hand-tuned seeds of the generator's params).

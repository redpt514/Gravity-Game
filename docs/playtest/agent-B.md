# Playtest: agent B (economy-breaker persona)

Persona: veteran TD/strategy designer. I played levels 1–5 blind through `npm run play` (seeds default, 1, 2, 3, 4 and more), then scripted grid searches, random searches and spam runs (~3,000 games in total). I read `params.ts`, `levels.ts`, `solutions.ts`, `game.ts`, `bodies.ts`, `field.ts`, `hud.ts` and the screenshots only after the blind runs.

**Verdict in one line:** one Lens (55 energy), dropped almost anywhere in round 1, wins levels 3, 4 and 5 without another input. Placing random Pulses wins L4 83% of the time and L5 77% of the time. Income is never needed, and score never rewards playing well.

## Per-level table

"Cheapest win" is the lowest energy spend that won. "Robust" means it won on every seed I tried.

| Lvl | Under-standing | Fun | Blind result | Cheapest win (energy) | Earliest win | Dominant strategy | Verdict |
|---|---|---|---|---|---|---|---|
| 1 First Light | 4 | 2 | 1 repulsor at (15,50): won only on seed 3 (1/4). 2 repulsors: won in R1 | **30** (1 repulsor). 37/91 grid spots win on seed default, 42/91 on seed 1, 34/91 on seed 2 | **R1** (cloud at t12) | Any repulsor on the circulation ring (y≈20 or y≈68). 2 repulsors 20–36 apart always win | One decision, then it's over. Energy +30/rd is never used. OK as a tutorial |
| 2 Nursery | 4 | 2 | 2 repulsors (80,20)+(80,70): won 3/3 seeds, R2–R3, spent 60 of 150 | **30**: 1 repulsor at (80,70) wins 5/5 seeds (R2–R3) | **R1**: repulsors (35.9,56.4)+(33.9,37.4), 60 energy, won R1 on 2/2 seeds | Repulsor pinch. **Walls never needed**, although walls are the lesson of this level | Seed 3: `Star #1 (m=120) at 92,87 ignited` in L2, so the L3 goal is met by accident. No new skill is tested |
| 3 Ignition | 4 | **1** | 1 repulsor: 0/5. Lens (80,75) alone: 5/5 | 35 (1 wall (96.7,54.8)→(54.5,80.2), R3, fragile). Robust: **55, 1 lens anywhere** | R2 (0/96 lens+repulsor combos won in R1) | **1 lens, any position: 273/273 wins** (91 grid spots × 3 seeds) | Degenerate. Placement doesn't matter. Seed default, lens at centre: planet at 119 after R2, 1 mass short, and the UI can't show that |
| 4 Forge | 3 | 1 | Lens at (80,45): 10/10 seeds, R3–R4 | 25 (1 pulse at (42,8), seed default only). Robust: **55, lens at centre** | **R1** (random 4-pulse spam, 3/30 runs) | Lens at centre. A 2nd lens stacked on it, a repulsor or a pulse changes nothing (see E2). Random pulses win 25/30 | Pulses are presented as a finesse tool but they are the strongest tool. He goal is on a fixed timetable |
| 5 Nova | 3 | 2 | Lens at (80,45): 3/3 seeds, won R4/R5 with **285 energy unspent** | **55** (1 lens, R1, nothing else) | **R3**: lens (80,45) in R1, lens (94,50) in R2+R3 → `Black hole #4 (m=610) collapsed`, 3/3 seeds | Lens at centre and wait. Random mixed spam wins 42/80. Random pulse spam 23/30 | The finale is solved by one click. The supernova is spectacular, but the player did nothing to earn it |

Reference solutions (`tests/solutions.ts`) across 8 seeds: L1 7/8 (**seed 4 loses**), L2 8/8, L3 8/8, L4 7/8 (**seed 6 loses in R2**), L5 8/8. They cost 60/70/125/200/200 energy, 2–4× the lens-only line. The designed play is strictly worse than the degenerate play.

## Exploits and degenerate solutions

**E1. The Lens is a free star oven.** A lens pulls gas into a halo 6.5× the cloud threshold (`densest d=18.88`, threshold 2.92, L4 after R1) and condenses a body 6 ticks in: `R1 t6: Cloud #1 (m=53) at 80,45 formed` then `Planet #1 (m=53) condensed`. The body stays pinned at the lens forever, always at maximum feed (`accreteFeedMax: 2`). Its mass then follows a fixed timetable: 53 → 88 → 132 → 184 → 247 per round (L4 seed default). You can't speed it up and you can't slow it down.

**E2. Nothing else matters once a lens is down.** L4, lens at (80,45), then one repulsor at each of 40 grid positions. The He-per-round curve was **exactly `[0,5,38,100]` for 34/40 positions**. Only the 6 repulsors within about 25 units of the lens changed it, by 1–6 He; 4 of those won one round sooner. A second lens stacked at the same point, or an added pulse, gave byte-identical results. The player's later decisions have no effect.

**E3. Blind pulse spam.** Spending all energy on pulses at uniformly random points:

| | R1 only (100 energy) | Every round |
|---|---|---|
| L4 | 20/30 wins | 25/30 wins (3 in R1) |
| L5 | 17/30 wins | 23/30 wins |

Pulse spam gets the highest scores: L5 up to 2206, against 584 for lens play. Cause: a new cloud captures **every** free particle within `cloudCaptureR` 4.5 with no cap, while accretion is rate-capped. Shock-compressing gas gives instant bodies: `R1 t185: Star #1 (m=148) ignited` from 4 random pulses. The same thing happens next to a lens: `R2 t9: Cloud #2 (m=147) at 92,49 formed / Star #2 ignited`. Supernova ejecta recondense in one tick: `Cloud #6 (m=229) formed / Star #6 (m=229) ignited`.

**E4. Board-centre dead zone.** The swirl is weak at the centre, so a lens there is isolated from the ring flow. That's why E2 holds.

**E5. Refunds and inventory: no exploit, but only because the reward system is dead.** Removing a node in the round it was placed refunds `floor(cost/2)`: a pulse gave 12 back. Removing after a round refunds 0. There's no mid-round remove. Free (inventory) nodes refund 100% if removed the same round. L5's `rewards: { black_hole: 1 }` is never delivered: `main.ts startLevel` calls `factory(id, seed)` with no inventory, and there is no level 6. Black hole and red matter (`unlockLevel: 6`) can't be reached.

**E6. Corner play loses.** All nodes in a corner, or a lens at (3,3), lost L4 3/3 and L5 3/3. Good.

## Economy analysis

| Lvl | Energy available (start + income × (rounds−1)) | Robust win spend | Utilisation | Energy left at win |
|---|---|---|---|---|
| 1 | 70+30 = 100 | 30–60 | 30–60% | 40 (R1 win) |
| 2 | 70+80 = 150 | 30 | 20% | 80–120 |
| 3 | 90+100 = 190 | 55 | 29% | 85–135 |
| 4 | 100+150 = 250 | 55 | 22% | 145–195 |
| 5 | 100+240 = 340 | 55 | 16% | 225–285 |

- **Income has no purpose.** No robust line needs a single income payment. Energy isn't scored (`score = clouds*10 + stars*50 + novae*200 + elements`), so there's no sink and no reason to save or spend.
- **No pressure.** Every goal `byRound` has 1–2 rounds of slack over the lens line. The one tight point is L3 on the default seed (119/120 at the R2 end), and there the only "decision" is to press End again.
- **Costs don't create choices.** Lens (55) does everything a repulsor (30) and a wall (35) do, and more, from L3 on. The pulse (25) is the cheapest tool and also the strongest.
- **Stacking is allowed**: `place lens 80,45` three times, all ok. That's harmless now only because of the accretion cap.
- **Levels don't build on each other.** L1 and L2 teach "squeeze the current". From L3 on, the lens makes that knowledge irrelevant. L4 adds He but no new verb. L5 adds giants and novae, but they happen on their own. Walls, the L2 headline tool, are never needed anywhere.

## Readability (cause → effect)

- The CLI help RULES paragraph is good: it covers current direction, the threshold (~1.9/cell, 2.4× mean) and the mass ladder. **The web HUD shows none of it.** It shows the intro sentence, goal label and count, and each tool's one-line description. There's no current direction, no threshold, no body mass or progress, and no mass ladder. `scene.ts` has no text or progress-ring drawing, and `Body.progress` is never rendered. On L3 a player at 119/120 mass sees `Ignite 1 star (0/1)`.
- The tool text doesn't give the radius. "Lens … Expensive" undersells a tool that wins the game.
- In `play.png` (portrait mobile), the 16:9 board fills about 25% of the screen height. Particles are uniform white dots, and the eye can't find the current or the density.
- ASCII map: `'@' = cloud-forming` is misleading. A lens holds a 10×10-cell `@` blob for rounds without making a new cloud (`minBodySpacing` blocks it). Bodies' own mass is also splatted into `density`, so a body shows up as `@`.
- After one round the whole board homogenises to `:`/`-`. The initial seed structure is erased, which is why seeds barely matter: L3 lens outcomes for seed default and seed 3 are identical, and so are seeds 2 and 4.

## Physics / lifecycle believability

1. **Bodies stick to the edges.** `moveBodies` clamps to `[r, W−r]` and zeroes velocity. Examples: planets at (157.7,2.3) and (157.2,28.6), clouds and planets at y=86–88 in most L2 runs. The swirl fades toward the corners, so corner bodies are stranded dead mass.
2. **A neutron star can vanish into a main-sequence star**: `Neutron star #2 merged into Star #4 (m=519)`. `mergeBodies` never lets a neutron or white dwarf upgrade the larger body. A remnant should dominate, or the merge should collapse.
3. **Neutron stars grow without limit**: `Planet #7 merged into Neutron star #4 (m=346)`. Nothing happens before 600 mass.
4. **Clouds are born at star mass** (147, 229) and skip the planet stage. That reads as teleportation, not accretion.
5. **Stars at a lens never move.** One body sits at (80,45) for five rounds while the gas swirls past it.

## Bugs (repro)

| # | Repro | Expected | Actual |
|---|---|---|---|
| B1 | Win L5 in the web UI, then start any level | black_hole ×1 in inventory | `startLevel` → `factory(id, seed)` with no `opts.inventory`, so the reward is lost. There's also no L6 |
| B2 | `npm run play -- --level 1 --seed 4`, then play `tests/solutions.ts` L1 (repulsors (62,45),(98,45)) | win | lost in R2. Same for L4 with `--seed 6` (lost R2). The UI uses a random seed (`Date.now()^…`), so `LevelDef.seed` is never used |
| B3 | `{"type":"place","tool":"wall","x":80,"y":45}` (no x2/y2) | reject | ok, and a silent 20-long horizontal wall is placed. A zero-length wall `x2=x,y2=y` also costs the full 35 |
| B4 | `place lens 80,45` ×3 | reject overlap | all accepted, nodes stacked at one point |
| B5 | L4: lens (80,45), run R1, `{"type":"ascii"}` | `@` = cloud forms | a 10×10 `@` blob (d=18.9) with only the one planet inside |
| B6 | L5: lens (80,45) R1, lens (94,50) R2 and R3 | — | `Neutron star #2 merged into Star #4 (m=519)` (remnant absorbed by a younger star) |

## Top 3 fixes (ranked by fun per unit of effort)

1. **Stop the Lens condensing and pinning bodies (one-line-class change, biggest impact).** Make the lens act on bodies only, or cap its gas pull below `cloudDensity`, so it can't create its own cloud or feed a pinned body at maximum. Raise its cost to about 80, so it has to be saved for with income. Then L3 plays the way the solution note intends ("dam the current, then lens the piles together"), and E1, E2 and E4 disappear.
2. **Cap instant capture and make energy count (`params.ts` plus a few lines).** Cap birth mass at about `planetMass`: `formClouds` takes at most N particles and leaves the rest to normal accretion. That kills pulse spam (E3) and 229-mass instant stars. Raise the pulse to about 40. Add score for leftover energy and unused rounds, and tighten the `byRound` limits (L4 "star by R1", L5 "nova by R4"), so the robust line needs at least one round of income. That creates a real save-or-spend decision.
3. **Show the rules on the board (medium effort, big readability gain).** Draw faint current streamlines, a threshold contour (density ≥ `cloudThreshold`), and a mass or progress ring on each body ("119/120"). Put the tool radius in the tool card, and show the mass ladder on the intro card. Right now the web player can't see the same cause and effect the CLI player gets from the help text.

Honourable mention: pass inventory between levels (B1) and add L6 content, or remove `rewards` until it's used.

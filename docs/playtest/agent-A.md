# Playtest: player-agent A (casual mobile puzzle player, first time)

Default seeds via `npm run play -- --level N`, all levels played blind before reading `tests/solutions.ts`.
Screenshots are in `docs/playtest/shots-A/` (vite preview + Playwright, phone 414x896 and desktop 1280x720).

## Per-level summary

| Lvl | Understand | Fun | Blind attempts (result) | Winning run: rounds / energy left | Verdict |
|---|---|---|---|---|---|
| 1 First Light | 3 | 2 | #1 lost (1 repulsor at centre, 0/1 clouds) · #2 **won** | R1 of 2, E=10 | Too easy. The cloud forms at **t24 of 600**, so 96% of the round is dead air. |
| 2 Nursery | 3 | 2 | #1 lost (repulsor on clump + short wall) · #2 **won** · #3 lost (walls only) | R2 of 3, E=20 | The wall is the new tool and I lost both runs that used it. The level is won with repulsors. |
| 3 Ignition | 3 | 1 | #1 **won** (lens) · #2 **won** (3 repulsors) | lens: R3, E=105 · repulsors: R2, E=20 | The featured lens is the slower, weaker option. After R1 my actions changed nothing. |
| 4 Forge | 3 | 4 | #1 lost (lens planet ended at **112/120**) · #2 **won** | R2 of 4, E=5 | The best level: merging 3 planets with a lens felt like a real puzzle. The helium goal (40 by R4) was met in R2 anyway (51). |
| 5 Nova | 2 | 2 | #1 **won** (the L4 recipe, unchanged) · #2 lost (lens first: white dwarf at **245**, then fed to **313**) | R3 of 5, E=75 | The finale is L4 again. Losing depends on a hidden number reached 4 rounds after the mistake that caused it. |

Overall: **understanding 3/5, fun 2/5.** Levels 1-3 fall to one dumb strategy. The bundled `--auto` bot rings the biggest body with repulsors and wins L1, L2 and L3. It loses L4 and L5.

## 1. Understanding

- **The intro is fine but the real rules live only in `help()`, which the UI never shows.** Things the game never tells a phone player:
  - the gas current runs counter-clockwise ("gas piles up upstream of obstacles")
  - the mass thresholds 40 / 120 / 250 / 320 (only 40, 120 and 250 appear in intros)
  - the fact that a giant's mass is checked when it runs out of He

  Every one of these decided a win or a loss for me.
- **Nothing tells you walls should be long.** The reference solutions dam half the board (`80,0 → 80,45`, 45 long). My walls were 25–32 long and did nothing much. "Herds particles like a fence" suggests a small fence, not a dam.
- **No mass on screen.** On L3 the goal reads `Ignite 1 star (mass 120) (0/1)` for 2 whole rounds while a planet silently grows 65 → 104 → 151. The HUD has no body labels and no progress-to-next-stage (`shots-A/L3-phone-3-after.png`). I was watching an orange blob with no idea whether I was winning.
- The CLI `progress` field is ambiguous. On L2 a cloud sat at `mass 39, progress 1` at the end of R1, which reads as "done", and it only became a planet at R2 t6.
- **ASCII `@` = "cloud-forming" contradicts itself.** On L3 the lens made a ~10x10-cell `@` blob with density **18.51** (7.4x the 2.50 threshold) and no new cloud formed. The same thing happened on L2 (`d 2.88 > 2.29`, a large `@` field, one cloud). The legend is lying.

## 2. Fun / agency

- **Dead rounds everywhere.** L3, lens run: in R2 I tried nothing, `r 84 68`, and a second lens stacked on the first. All three gave **identical** results (planet 104 at the end of R2, star at R3 t212, mass 151).
- L4, lens run, R2: nothing, 2 pulses, repulsor + pulse, and a second lens. The planet ends at **112** in every case except a pulse on top, which scatters it to 100. Accretion speed is fixed, so after round 1 the player just watches.
- L5, lens-first run, R5: I had **285 energy**. Three extra lenses, three pulses, four repulsors, or a lens+repulsor combo all gave **white dwarf 245/246 → 313**. The level was already lost in R1 and told me in R5.
- **Stacked nodes are allowed, charged, and do nothing** (a second lens at the same x,y changed mass by 0).
- **A dominant boring strategy.** Three repulsors in a triangle around the densest cell from `state.densest`, then one lens between the planets in R2, won both L4 and L5. The reference solution is also *literally the same list* for L4 and L5. Across seeds 1-10 the fixed-coordinate reference recipes won **48/50**, so the levels do not change enough between seeds to force re-thinking.
- The best moment was L4 R2: the lens at (122,22) pulled planets 55+49 into a 157 star at t49, a cloud fed it to 219, and I could see cause and effect. More of that please.

## 3. Difficulty curve

- L1 and L2 are trivial. Any repulsor within ~15 units of a starting clump wins: 6 of 9 single-repulsor spots I tried on L1 won with no follow-up.
- L3 is easier than L2 if you ignore the lens (won in R2).
- L4 is the first real puzzle, and its trap is the tool the previous level taught me (lens only → 112/120).
- L5 is the L4 recipe again (won R3 of 5, 75 energy unused, **141** C+O vs 20 needed). Or it is an invisible trap: a giant at **245** is 5 under the 250 cutoff, and a dwarf at 313 is 7 under the 320 cutoff.
- Goals are over-tuned in the easy direction:
  - L4 "Fuse 40 He by R4": 51 by R2.
  - L5 "20 C+O by R4": 141 by R3.
  - Wins routinely come 1–2 rounds early, so income (+40 to +60 per round) is mostly never spent.

## 4. Loop mechanics

- Income vs cost is irrelevant. I finished L3 with 105 energy and L5 with 75, and I lost L5 with 285 unspent. Energy only matters in round 1.
- It does not feel like reverse tower defence. There is no pressure between rounds and no threat, and permanent nodes mean round 2+ is "Run round" again.
- Levels teach the tools (repulsor → wall → lens → pulse) but do not *require* them. A repulsor ring beats L2 without walls and L3 without lenses. The pulse is optional in L4/L5.
- The L5 reward (`black_hole: 1`) goes to the inventory, but there is no level 6 (`--level 6` → `Error: unknown level 6`). On the UI the "Next level" button after L5 just returns to level select.

## 5. Readability (node → density → cloud → star)

- **CLI/ASCII:** the density map is readable and `densest` is the most useful thing in the game. But `@` does not mean a cloud will form (see above). Bodies are single letters with no mass.
- The log is good ("R2 t438: Planet #1 merged into Planet #4 (m=198)"). **The UI never shows it**: `hud.ts` has no log/toast, so supernovae, merges and "white dwarf remains" go unexplained on screen.
- **Phone (414x896):** the 16:9 board is a 414x233 strip, and about 45% of the screen is empty black above and below it (`shots-A/L1-phone-fixed-2-midround.png`). The palette stays on screen, greyed out, during the run.
- Particles look like uniform static. There are no current arrows and no density shading, so "upstream" cannot be seen.
- **Desktop (1280x720):** the board fills the viewport and the HUD sits *on top of* it. The top bar and goals cover world y ≲ 7, and the bottom bar covers y ≳ 58 of 90 (`shots-A/L3-landscape-hud-covers-board.png`). Those are roughly the bottom 35% and the top-left of the play area.
- The round-end card says only "Income +50". It should report what happened (e.g. "Planet 65 → 104 (needs 120)").
- The lost card says "A goal was missed. Try a different layout." It does not say which goal or why (the log knows: "White dwarf #1 (m=245) remains").

## 6. Bugs (with repro)

1. **HUD covers a third of the board on desktop, and taps there are swallowed.** Build + preview at 1280x720 on L3, select Lens, tap world (100,60): nothing placed, energy stays 90. A wall dragged from world (80,2) is also not placed (it starts under the goals panel). File: `shots-A/L3-landscape-hud-covers-board.png`.
2. **Re-tapping the tool card deselects it, and the next board tap silently does nothing.**
   - Repro: on L1, tap Repulsor, tap the board (placed), tap Repulsor again (the natural "pick tool, place" rhythm), then tap the board. Nothing is placed and energy stays 40.
   - Cause: `main.ts:96` toggles `selectedTool === tool ? null : tool`, while `onPlaced` keeps the tool selected.
   - File: `shots-A/L1-phone-midround-deselect-bug.png` (only one of two repulsors).
3. **Loss message blames goals that are not due yet.** L2: `r 71 58; w 128 4 128 30; endRound; endRound` gives the log `Level lost: missed Have 2 clouds ... (0/2); Grow 1 planet (mass 40) (0/1)`. The planet goal is due R3. Cause: `game.ts:122` lists all unmet goals.
4. **Wall silently clamped.** `place wall 10,10 → 150,80` returns `ok:true` and the wall ends at (54.7,32.4) with no reason text. A **zero-length wall** (x2=x, y2=y) is also accepted and charged 35.
5. **Stacked identical nodes are accepted and charged** (`place repulsor 40,45` twice → two nodes, −60), with no added effect for lenses (L3/L4 tests above).
6. **Removing a node from an earlier round returns `ok:true` with no hint that the refund is 0.** Same-round removal of a wall refunds 17 of 35 (floored).
7. **L5 cloud spawns at huge mass.** L5 lens-first run, then in R5 `l 98 35; r 98 55; r 118 40; r 78 40`: the log shows `R5 t60: Cloud #2 (m=173) at 98,35 formed` / `Star #2 (m=173) ignited` in the same tick. A 173-mass body appears from nothing.
   - Relatedly, a lens holding a 226 star 15 units from a lens holding the 313 dwarf never merged them (539 > 320 would have exploded it). "Lenses pull bodies together" does not hold between two lenses.
8. **UI seed ≠ CLI seed.** `main.ts` uses `factory(id, Date.now() ^ id*7919)`, so the browser never plays the tested default seed. The reference L1 solution loses on seed 4, and L4 loses on seed 6.
9. Visual: the wall's glow beam bleeds out of the board up to the top bar on phone (`shots-A/L3-phone-2-midround.png`).

## 7. Top 3 fixes (fun per effort)

1. **Show body mass and next threshold on screen, plus the event log as toasts** (e.g. "Planet 104/120 → star", "Giant 245 < 250: will fade to white dwarf").
   - Effort: small (data already in `GameState.bodies` / `log`).
   - Payoff: fixes the "(0/1) for two rounds" blindness and the unexplained L5 loss. It also gives dead rounds some tension, and makes near-misses (112/120, 245/250, 313/320) feel like near-misses instead of random.
2. **Make later rounds matter: let player actions speed up accretion or merging.** Candidates:
   - lens strength stacks, or a lens pulls neighbouring bodies/lenses together
   - repulsors/pulses near a body push gas *into* it faster
   - end the round early once goals are met

   Then retune goals so wins land on the last round (e.g. L4 He 40 → ~110 by R4; L5 C+O 20 → ~100 and supernova by R5 with a starting layout that needs 2 merges).
   - Effort: medium (params + goal numbers).
   - Payoff: kills the "spend R1, watch R2–R5 with 285 energy" loop.
3. **Fix the HUD layout.** Letterbox the board *between* the top bar and the bottom bar on desktop, move goals off the board, and hide the greyed palette while running (use the freed phone height to enlarge the board). Also stop the tool card from deselecting on re-tap.
   - Effort: small CSS/layout + a one-line toggle change.
   - Payoff: today a third of the desktop board cannot be tapped, and the natural phone tap rhythm silently fails every second placement.

(Honourable mention: draw faint current arrows and upstream pile-up shading. It is the core mechanic and it is currently invisible.)

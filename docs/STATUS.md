# Status — paused for human review after loop 1 (2026-09-24)

**Play it:** https://claude.ai/artifact/XwSAcJMkR5fPFwGZb8PfZG (private artifact, build 2).
GitHub Pages: enable Pages → Source "GitHub Actions" in repo settings; workflow `.github/workflows/pages.yml`
deploys on push to `main` or `claude/**`.

**Local:** `npm i && npm run dev` (browser), `npm test`, `npm run play -- --level 3 --auto` (headless),
`npm run play -- --level 3` (JSON REPL for agents), `npm run eval` (balance harness).

## Loop 1 summary
| Step | Result |
|---|---|
| Build | sim (grid field + particles + lifecycle + fusion + nova), levels 1–5, CLI, WebGL/Canvas front end |
| Playtest A (casual) | understanding 3/5, fun 2/5: dead rounds after r1, hidden numbers, HUD overlap |
| Playtest B (systems) | Lens alone won L3–L5 (273/273 spots); pulse spam won L4/L5 ~80%; economy irrelevant |
| Refine | Lens acts on bodies only (0/9 solo wins); cloud birth capped (pulse spam 1–2/20); growth follows gas density (+45–80% from a round-2 repulsor); placement validation; lifecycle bugs; goals retuned; mass rings, toasts, current arrows, threshold shading, HUD no longer covers board; deterministic seeds; reward carry-over |
| Verification | typecheck clean, 50/50 tests, headless smoke 0 console errors, scripted solutions win seeds 1–8, place-nothing loses |

## Known issues / decisions for the human
1. Wide viewports: the tall palette card shrinks the board (letterboxed to ~55% width at 1280×720). Palette should be a compact row.
2. L3 winnable with one wall (35 energy); L2 winnable with repulsors only. Deadlines still loose on some seeds.
3. Auto-bot loses L4/L5 (naive; fine, but no automated regression for those beyond scripted solutions).
4. Every log line toasts, including "Round N running" noise.
5. No level 6; black-hole reward carries over but has nowhere to go yet. No audio, saves beyond localStorage, or Capacitor build.
6. Design question: keep the gas current (added so squeezing does something)? Playtesters liked cause→effect once drawn, but it isn't in the original pitch.

## Proposed loop 2
Palette layout fix → second blind playtest on refined build → tighten L2/L3 → level 6 with black hole → Capacitor scaffold.

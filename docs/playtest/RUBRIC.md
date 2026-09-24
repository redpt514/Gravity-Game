# Playtest rubric (player-agents)

Play levels 1–5 via `npm run play -- --level N` (JSON REPL, `{"type":"help"}` first) as a
*new player*: read only what the game shows (help(), intro, goal labels, tool descriptions).
Do NOT read tests/solutions.ts until after your blind attempts. Then read src/ui/* to judge
the UI as described in code + docs/screenshots.

Report per level, then overall. Be harsh and specific; quote numbers.
1. **Understanding** (1–5): could you tell what to do from intro + goals + tool text alone? What confused you?
2. **Fun / agency** (1–5): did placements visibly change outcomes? Was there a dominant boring strategy? Dead rounds?
3. **Difficulty**: blind attempts to win, rounds used, energy left. Too easy/hard? Cliff between levels?
4. **Loop mechanics**: income vs cost, does round structure feel like reverse tower defense? Does the level build on the previous one?
5. **Readability**: is the cause→effect (node → density → cloud → star) legible in the state/ASCII map?
6. **Bugs** (repro steps).
7. **Top 3 fixes**, ranked by fun-per-effort.

Write to docs/playtest/<agent-name>.md. Terse, tables where possible.

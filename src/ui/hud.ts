/** HUD: top bar, goals, tool palette, run/progress control, intro/round-end/won/lost cards. */
import type { GameState, ToolId } from '../sim/types';
import { TOOL_DEFS } from '../render/toolDefs';

export interface HudUiState {
  selectedTool: ToolId | null;
  speed: 1 | 2;
  scoreboardOpen: boolean;
}

export interface HudCallbacks {
  onSelectTool(tool: ToolId): void;
  onStart(): void; // Action{type:'start'}: dismiss intro/roundEnd card -> plan (or won/lost)
  onEndRound(): void; // Action{type:'endRound'}: plan -> running
  onRestart(): void;
  onNextLevel(): void; // won screen: advance to the following level
  onLevels(): void; // won/lost screen: back to level select
  onToggleSpeed(): void;
  onToggleScoreboard(): void;
}

const KIND_LABEL: Record<string, string> = {
  cloud: 'Clouds',
  planet: 'Planets',
  star_ms: 'Main-sequence stars',
  star_giant: 'Red giants',
  white_dwarf: 'White dwarfs',
  neutron: 'Neutron stars',
  black_hole: 'Black holes',
};

function fmt(n: number): string {
  return n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
}

export function createHud(root: HTMLElement, cb: HudCallbacks) {
  root.innerHTML = `
    <div class="layer">
      <div class="topbar panel">
        <span class="level-name" id="h-level"></span>
        <span class="round" id="h-round"></span>
        <span class="energy" id="h-energy"></span>
        <button class="speed-toggle" id="h-speed">1x</button>
        <button class="scoreboard-toggle" id="h-score-toggle">Scoreboard</button>
      </div>
      <div class="goals panel" id="h-goals"></div>
      <div class="scoreboard-drawer panel" id="h-score-drawer" hidden></div>
    </div>
    <div class="spacer"></div>
    <div class="layer">
      <div class="bottombar panel" id="h-bottombar">
        <div class="palette" id="h-palette"></div>
        <div class="run-row" id="h-runrow"></div>
      </div>
    </div>
    <div id="h-overlay"></div>
  `;

  const el = {
    level: root.querySelector<HTMLElement>('#h-level')!,
    round: root.querySelector<HTMLElement>('#h-round')!,
    energy: root.querySelector<HTMLElement>('#h-energy')!,
    speed: root.querySelector<HTMLButtonElement>('#h-speed')!,
    goals: root.querySelector<HTMLElement>('#h-goals')!,
    scoreToggle: root.querySelector<HTMLButtonElement>('#h-score-toggle')!,
    scoreDrawer: root.querySelector<HTMLElement>('#h-score-drawer')!,
    bottombar: root.querySelector<HTMLElement>('#h-bottombar')!,
    palette: root.querySelector<HTMLElement>('#h-palette')!,
    runrow: root.querySelector<HTMLElement>('#h-runrow')!,
    overlay: root.querySelector<HTMLElement>('#h-overlay')!,
  };

  el.speed.addEventListener('click', () => cb.onToggleSpeed());
  el.scoreToggle.addEventListener('click', () => cb.onToggleScoreboard());

  let lastPaletteKey = '';
  let lastPhase = '';
  let lastRunRowPhase = '';

  function renderScoreboardRows(state: GameState): string {
    const sb = state.scoreboard;
    const rows: string[] = [];
    rows.push(`<div class="k">Clouds formed</div><div class="v">${fmt(sb.cloudsFormed)}</div>`);
    for (const kind of Object.keys(sb.starsByKind)) {
      if (kind === 'cloud') continue;
      const n = sb.starsByKind[kind as keyof typeof sb.starsByKind];
      if (!n) continue;
      rows.push(`<div class="k">${KIND_LABEL[kind] ?? kind}</div><div class="v">${fmt(n)}</div>`);
    }
    rows.push(`<div class="k">Novae</div><div class="v">${fmt(sb.novae)}</div>`);
    for (const el2 of Object.keys(sb.elements)) {
      const n = sb.elements[el2 as keyof typeof sb.elements];
      rows.push(`<div class="k">${el2}</div><div class="v">${fmt(n)}</div>`);
    }
    return rows.join('');
  }

  function update(state: GameState, ui: HudUiState) {
    el.level.textContent = state.level.name;
    el.round.textContent = `Round ${state.round}/${state.level.rounds}`;
    el.energy.innerHTML = `⚡ ${Math.floor(state.energy)}${
      state.phase === 'plan' ? `<span class="income">+${state.level.incomePerRound}/rd</span>` : ''
    }`;
    el.speed.textContent = `${ui.speed}x`;
    el.speed.classList.toggle('on', ui.speed === 2);

    // goals
    el.goals.innerHTML = state.goals
      .map((g) => {
        const deadline = !g.met && g.goal.byRound === state.round && state.phase !== 'plan';
        const cls = g.met ? 'met' : deadline ? 'deadline' : '';
        return `<div class="goal ${cls}"><span class="dot"></span><span>${g.goal.label} (${fmt(
          g.current,
        )}/${g.goal.count})</span><span class="byround">by rd ${g.goal.byRound}</span></div>`;
      })
      .join('');

    // scoreboard drawer
    el.scoreDrawer.hidden = !ui.scoreboardOpen;
    if (ui.scoreboardOpen) {
      el.scoreDrawer.innerHTML = `<div class="scorelist">${renderScoreboardRows(state)}</div>`;
    }
    const showScoreToggle = state.phase === 'plan' || state.phase === 'running' || state.phase === 'roundEnd';
    el.scoreToggle.hidden = !showScoreToggle;
    if (!showScoreToggle) el.scoreDrawer.hidden = true;

    // palette + run row only meaningful during plan/running/roundEnd
    const inPlay = state.phase === 'plan' || state.phase === 'running' || state.phase === 'roundEnd';
    el.bottombar.style.display = inPlay ? 'flex' : 'none';

    if (inPlay) {
      const paletteKey = `${state.phase}|${state.energy}|${ui.selectedTool}|${state.level.tools.join(',')}|${JSON.stringify(
        state.inventory,
      )}`;
      if (paletteKey !== lastPaletteKey) {
        lastPaletteKey = paletteKey;
        // palette = this level's tools, plus any reward tool sitting in inventory
        // (e.g. black_hole from a previous level's win) even if not in level.tools
        const invTools = (Object.keys(state.inventory) as ToolId[]).filter(
          (t) => (state.inventory[t] ?? 0) > 0 && !state.level.tools.includes(t),
        );
        el.palette.innerHTML = [...state.level.tools, ...invTools]
          .map((tool) => {
            const def = TOOL_DEFS[tool];
            const inv = state.inventory[tool] ?? 0;
            const affordable = inv > 0 || state.energy >= def.cost;
            const selected = ui.selectedTool === tool;
            const disabled = state.phase !== 'plan' || !affordable;
            return `<button class="tool-card${selected ? ' selected' : ''}" data-tool="${tool}" ${
              disabled ? 'disabled' : ''
            }>
              <span class="name">${def.name}</span>
              <span class="desc">${def.description}</span>
              <span class="meta"><span class="cost">${inv > 0 ? 'free' : `⚡${def.cost}`}</span>${
                inv > 0 ? `<span class="count">×${inv}</span>` : ''
              }</span>
            </button>`;
          })
          .join('');
        el.palette.querySelectorAll<HTMLButtonElement>('.tool-card').forEach((btn) => {
          btn.addEventListener('click', () => {
            const tool = btn.dataset.tool as ToolId;
            cb.onSelectTool(tool);
          });
        });
      }

      const pct = Math.min(100, Math.round((state.tick / state.level.ticksPerRound) * 100));
      if (state.phase !== lastRunRowPhase) {
        lastRunRowPhase = state.phase;
        if (state.phase === 'plan') {
          el.runrow.innerHTML = `<button class="btn-primary" id="h-run">Run round</button>`;
          el.runrow.querySelector('#h-run')!.addEventListener('click', () => cb.onEndRound());
        } else if (state.phase === 'running') {
          el.runrow.innerHTML = `<div class="progress-wrap"><div class="progress-track"><div class="progress-fill" id="h-progress-fill" style="width:${pct}%"></div></div><div class="progress-label" id="h-progress-label">Round ${state.round} running… ${pct}%</div></div>`;
        } else if (state.phase === 'roundEnd') {
          el.runrow.innerHTML = `<button class="btn-primary" id="h-continue">Continue</button>`;
          el.runrow.querySelector('#h-continue')!.addEventListener('click', () => cb.onStart());
        }
      } else if (state.phase === 'running') {
        // patch the existing bar in place instead of rebuilding DOM every frame
        // (rebuilding here would race with in-flight pointer/click handling)
        const fill = el.runrow.querySelector<HTMLElement>('#h-progress-fill');
        const label = el.runrow.querySelector<HTMLElement>('#h-progress-label');
        if (fill) fill.style.width = `${pct}%`;
        if (label) label.textContent = `Round ${state.round} running… ${pct}%`;
      }
    }

    // overlays
    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      renderOverlay(state);
    }
  }

  function renderOverlay(state: GameState) {
    if (state.phase === 'intro') {
      el.overlay.innerHTML = `
        <div class="overlay">
          <div class="card panel">
            <h1>${state.level.name}</h1>
            <p>${state.level.intro}</p>
            <button class="btn-primary" id="h-start">Start</button>
          </div>
        </div>`;
      el.overlay.querySelector('#h-start')!.addEventListener('click', () => cb.onStart());
      return;
    }
    if (state.phase === 'roundEnd') {
      const met = state.goals.filter((g) => g.goal.byRound <= state.round);
      el.overlay.innerHTML = `
        <div class="overlay" id="h-roundend-overlay" style="align-items:flex-end;background:transparent;padding-bottom:190px;pointer-events:none;">
          <div class="card panel" style="width:min(360px,92vw);margin:0 auto;">
            <h2>Round ${state.round} complete</h2>
            <div class="scorelist">
              ${met
                .map(
                  (g) =>
                    `<div class="k">${g.goal.label}</div><div class="v" style="color:${
                      g.met ? 'var(--good)' : 'var(--danger)'
                    }">${g.met ? 'met' : 'missed'}</div>`,
                )
                .join('')}
              <div class="k">Income</div><div class="v">+${state.level.incomePerRound}</div>
            </div>
          </div>
        </div>`;
      return;
    }
    if (state.phase === 'won' || state.phase === 'lost') {
      const won = state.phase === 'won';
      el.overlay.innerHTML = `
        <div class="overlay">
          <div class="card panel">
            <h1>${won ? 'Level complete!' : 'Level failed'}</h1>
            <p>${won ? 'All goals met. The nursery grows on.' : 'A goal was missed. Try a different layout.'}</p>
            <div class="scorelist">${renderScoreboardRows(state)}</div>
            <div class="row">
              ${won ? '<button class="btn-primary" id="h-next">Next level</button>' : ''}
              <button class="${won ? 'btn-secondary' : 'btn-primary'}" id="h-retry">${won ? 'Replay' : 'Retry'}</button>
              <button class="btn-secondary" id="h-exit">Levels</button>
            </div>
          </div>
        </div>`;
      if (won) {
        el.overlay.querySelector('#h-next')!.addEventListener('click', () => cb.onNextLevel());
      }
      el.overlay.querySelector('#h-retry')!.addEventListener('click', () => cb.onRestart());
      el.overlay.querySelector('#h-exit')!.addEventListener('click', () => cb.onLevels());
      return;
    }
    el.overlay.innerHTML = '';
  }

  return { update };
}

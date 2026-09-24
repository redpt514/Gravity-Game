/** HUD: top bar, goals, tool palette, run/progress control, intro/round-end/won/lost cards. */
import type { Goal, GameState, ToolId } from '../sim/types';
import { TOOL_DEFS, TOOL_COLOR } from '../render/toolDefs';
import { P } from '../sim/params';
import { createToastManager } from './toast';

export interface HudUiState {
  selectedTool: ToolId | null;
  speed: 1 | 2;
  scoreboardOpen: boolean;
  logOpen: boolean;
}

export interface HudCallbacks {
  onSelectTool(tool: ToolId): void;
  onStart(): void; // Action{type:'start'}: dismiss intro/roundEnd card -> plan (or won/lost)
  onEndRound(): void; // Action{type:'endRound'}: plan -> running
  onRestart(): void;
  onNewLayout(): void; // lost card: retry with a freshly-picked seed
  onNextLevel(): void; // won screen: advance to the following level
  onLevels(): void; // won/lost screen: back to level select
  onToggleSpeed(): void;
  onToggleScoreboard(): void;
  onToggleLog(): void;
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

/** "best body 112/120" hint for a not-yet-met goal: the nearest body's progress toward the
 * mass threshold the goal is chasing. Reads thresholds from sim/params.ts at call time. */
function bestBodyProgress(state: GameState, goal: Goal): string | null {
  if (goal.type === 'stars' || goal.type === 'star_kind') {
    const cand = state.bodies.filter((b) => b.kind === 'cloud' || b.kind === 'planet');
    if (!cand.length) return null;
    const best = cand.reduce((a, b) => (b.mass > a.mass ? b : a));
    return `best body ${Math.round(best.mass)}/${P.starMass}`;
  }
  if (goal.type === 'planets') {
    const cand = state.bodies.filter((b) => b.kind === 'cloud');
    if (!cand.length) return null;
    const best = cand.reduce((a, b) => (b.mass > a.mass ? b : a));
    return `best body ${Math.round(best.mass)}/${P.planetMass}`;
  }
  return null;
}

export function createHud(root: HTMLElement, cb: HudCallbacks) {
  root.innerHTML = `
    <div class="layer" id="h-top-layer">
      <div class="topbar panel">
        <span class="level-name" id="h-level"></span>
        <span class="round" id="h-round"></span>
        <span class="energy" id="h-energy"></span>
        <span class="spacer-x"></span>
        <button class="goals-chip" id="h-goals-chip"></button>
        <button class="icon-btn" id="h-menu-toggle" aria-label="Menu">&#8942;</button>
      </div>
      <div class="dropdown goals-drawer panel" id="h-goals-drawer" hidden></div>
      <div class="dropdown panel" id="h-menu-drawer" hidden>
        <div class="menu-actions">
          <button id="h-speed">1x speed</button>
          <button id="h-log-toggle">Log</button>
          <button id="h-score-toggle">Scoreboard</button>
        </div>
        <div class="scoreboard-drawer" id="h-score-drawer" hidden></div>
        <div class="log-drawer" id="h-log-drawer-inner" hidden></div>
      </div>
      <div class="toast-stack" id="h-toasts"></div>
    </div>
    <div class="spacer"></div>
    <div class="layer" id="h-bottom-layer">
      <div class="tool-strip panel" id="h-tool-strip" hidden></div>
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
    goalsChip: root.querySelector<HTMLButtonElement>('#h-goals-chip')!,
    goalsDrawer: root.querySelector<HTMLElement>('#h-goals-drawer')!,
    menuToggle: root.querySelector<HTMLButtonElement>('#h-menu-toggle')!,
    menuDrawer: root.querySelector<HTMLElement>('#h-menu-drawer')!,
    speed: root.querySelector<HTMLButtonElement>('#h-speed')!,
    scoreToggle: root.querySelector<HTMLButtonElement>('#h-score-toggle')!,
    scoreDrawer: root.querySelector<HTMLElement>('#h-score-drawer')!,
    logToggle: root.querySelector<HTMLButtonElement>('#h-log-toggle')!,
    logDrawer: root.querySelector<HTMLElement>('#h-log-drawer-inner')!,
    toolStrip: root.querySelector<HTMLElement>('#h-tool-strip')!,
    bottombar: root.querySelector<HTMLElement>('#h-bottombar')!,
    palette: root.querySelector<HTMLElement>('#h-palette')!,
    runrow: root.querySelector<HTMLElement>('#h-runrow')!,
    overlay: root.querySelector<HTMLElement>('#h-overlay')!,
    toasts: root.querySelector<HTMLElement>('#h-toasts')!,
  };

  const toaster = createToastManager(el.toasts);

  // Goals start expanded so the player sees what to do; the chip collapses them.
  let goalsOpen = true;
  let menuOpen = false;
  el.goalsDrawer.hidden = false;
  el.menuDrawer.hidden = true;
  el.goalsChip.addEventListener('click', (ev) => {
    ev.stopPropagation();
    goalsOpen = !goalsOpen;
    menuOpen = false;
    el.goalsDrawer.hidden = !goalsOpen;
    el.menuDrawer.hidden = true;
  });
  el.menuToggle.addEventListener('click', (ev) => {
    ev.stopPropagation();
    menuOpen = !menuOpen;
    goalsOpen = false;
    el.menuDrawer.hidden = !menuOpen;
    el.goalsDrawer.hidden = true;
  });
  // Outside clicks close the menu only; the goals list stays until its chip is tapped.
  root.addEventListener('click', () => {
    menuOpen = false;
    el.menuDrawer.hidden = true;
  });
  el.goalsDrawer.addEventListener('click', (ev) => ev.stopPropagation());
  el.menuDrawer.addEventListener('click', (ev) => ev.stopPropagation());

  el.speed.addEventListener('click', () => cb.onToggleSpeed());
  el.scoreToggle.addEventListener('click', () => cb.onToggleScoreboard());
  el.logToggle.addEventListener('click', () => cb.onToggleLog());

  let lastPaletteKey = '';
  let lastPhase = '';
  let lastRunRowPhase = '';
  let lastLogLen = -1;
  let lastLogRenderKey = '';
  let lastSelectedTool: ToolId | null = null;

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
    el.round.textContent = `R${state.round}/${state.level.rounds}`;
    el.energy.innerHTML = `⚡${Math.floor(state.energy)}${
      state.phase === 'plan' ? `<span class="income">+${state.level.incomePerRound}</span>` : ''
    }`;
    el.speed.textContent = `${ui.speed}x speed`;
    el.speed.classList.toggle('on', ui.speed === 2);

    // goals summary chip (collapsed) + full list in its dropdown
    const metCount = state.goals.filter((g) => g.met).length;
    const anyDeadline = state.goals.some(
      (g) => !g.met && g.goal.byRound === state.round && state.phase !== 'plan',
    );
    el.goalsChip.className = `goals-chip${
      metCount === state.goals.length && state.goals.length > 0 ? ' all-met' : anyDeadline ? ' deadline' : ''
    }`;
    el.goalsChip.innerHTML = `<span class="dot"></span><span>Goals ${metCount}/${state.goals.length}</span>`;
    // each goal shows the nearest body's progress toward the threshold it needs, if any
    el.goalsDrawer.innerHTML = state.goals
      .map((g) => {
        const deadline = !g.met && g.goal.byRound === state.round && state.phase !== 'plan';
        const cls = g.met ? 'met' : deadline ? 'deadline' : '';
        const near = g.met ? null : bestBodyProgress(state, g.goal);
        return `<div class="goal ${cls}"><span class="dot"></span><span>${g.goal.label} (${fmt(
          g.current,
        )}/${g.goal.count})${near ? ` — ${near}` : ''}</span><span class="byround">by rd ${g.goal.byRound}</span></div>`;
      })
      .join('');

    // scoreboard drawer (inside the overflow menu)
    el.scoreDrawer.hidden = !ui.scoreboardOpen;
    if (ui.scoreboardOpen) {
      el.scoreDrawer.innerHTML = `<div class="scorelist">${renderScoreboardRows(state)}</div>`;
    }
    const showScoreToggle = state.phase === 'plan' || state.phase === 'running' || state.phase === 'roundEnd';
    el.scoreToggle.hidden = !showScoreToggle;
    el.logToggle.hidden = !showScoreToggle;
    el.goalsChip.hidden = !showScoreToggle || state.goals.length === 0;
    if (!showScoreToggle) { el.scoreDrawer.hidden = true; el.logDrawer.hidden = true; }

    // event log: collapsible panel (last 8) + a toast for each new entry
    if (lastLogLen < 0 || state.log.length < lastLogLen) {
      // first render, or the game restarted and the log reset — resync without toasting
      lastLogLen = state.log.length;
    } else if (state.log.length > lastLogLen) {
      for (let i = lastLogLen; i < state.log.length; i++) {
        const line = state.log[i];
        const warn = /lost|supernova|missed/i.test(line);
        toaster.show(line, warn ? 'warn' : 'info');
      }
      lastLogLen = state.log.length;
    }
    el.logDrawer.hidden = !ui.logOpen;
    if (ui.logOpen) {
      const last8 = state.log.slice(-8);
      const key = last8.join('|');
      if (key !== lastLogRenderKey) {
        lastLogRenderKey = key;
        el.logDrawer.innerHTML = `<div class="loglist">${last8
          .map((l) => `<div class="logline">${l}</div>`)
          .join('')}</div>`;
      }
    }

    // palette + run row only meaningful during plan/running/roundEnd
    const inPlay = state.phase === 'plan' || state.phase === 'running' || state.phase === 'roundEnd';
    el.bottombar.style.display = inPlay ? 'flex' : 'none';
    if (!inPlay) el.toolStrip.hidden = true;

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
            return `<button class="tool-chip${selected ? ' selected' : ''}" data-tool="${tool}" title="${
              def.description
            }" ${disabled ? 'disabled' : ''}>
              <span class="dot" style="background:${TOOL_COLOR[tool]}"></span>
              <span class="chip-name">${def.name}</span>
              <span class="chip-cost">${inv > 0 ? `free ×${inv}` : `⚡${def.cost}`}</span>
            </button>`;
          })
          .join('');
        el.palette.querySelectorAll<HTMLButtonElement>('.tool-chip').forEach((btn) => {
          btn.addEventListener('click', () => {
            const tool = btn.dataset.tool as ToolId;
            cb.onSelectTool(tool);
          });
        });
      }

      // selected tool's one-line description, shown in a strip above the palette
      if (ui.selectedTool !== lastSelectedTool) {
        lastSelectedTool = ui.selectedTool;
        if (ui.selectedTool) {
          const def = TOOL_DEFS[ui.selectedTool];
          el.toolStrip.innerHTML = `<b>${def.name}:</b> ${def.description}`;
          el.toolStrip.hidden = false;
        } else {
          el.toolStrip.hidden = true;
        }
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
        <div class="overlay" id="h-roundend-overlay" style="align-items:flex-end;background:transparent;padding-bottom:88px;pointer-events:none;">
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
      // lost: only show goals that were actually due, so the card doesn't blame goals with
      // rounds left to go (see src/levels/goals.ts judge()).
      const due = won ? [] : state.goals.filter((g) => g.goal.byRound <= state.round);
      const dueRows = due
        .map(
          (g) =>
            `<div class="k">${g.goal.label}</div><div class="v" style="color:${
              g.met ? 'var(--good)' : 'var(--danger)'
            }">${g.met ? 'met' : `missed (${fmt(g.current)}/${g.goal.count})`}</div>`,
        )
        .join('');
      el.overlay.innerHTML = `
        <div class="overlay">
          <div class="card panel">
            <h1>${won ? 'Level complete!' : 'Level failed'}</h1>
            <p>${won ? 'All goals met. The nursery grows on.' : 'A due goal was missed:'}</p>
            ${due.length ? `<div class="scorelist">${dueRows}</div>` : ''}
            <div class="scorelist">${renderScoreboardRows(state)}</div>
            <div class="row">
              ${won ? '<button class="btn-primary" id="h-next">Next level</button>' : ''}
              <button class="${won ? 'btn-secondary' : 'btn-primary'}" id="h-retry">${won ? 'Replay' : 'Retry'}</button>
              ${!won ? '<button class="btn-secondary" id="h-newlayout">New layout</button>' : ''}
              <button class="btn-secondary" id="h-exit">Levels</button>
            </div>
          </div>
        </div>`;
      if (won) {
        el.overlay.querySelector('#h-next')!.addEventListener('click', () => cb.onNextLevel());
      } else {
        el.overlay.querySelector('#h-newlayout')!.addEventListener('click', () => cb.onNewLayout());
      }
      el.overlay.querySelector('#h-retry')!.addEventListener('click', () => cb.onRestart());
      el.overlay.querySelector('#h-exit')!.addEventListener('click', () => cb.onLevels());
      return;
    }
    el.overlay.innerHTML = '';
  }

  return { update, toast: toaster.show };
}

/** HUD: top bar (score/energy), a countdown-goal pill strip (never overlays the board), bottom
 * palette + play controls (pause/speed/hint), and the intro card / non-blocking cleared banner. */
import type { GameState, GoalStatus, ToolId } from '../sim/types';
import { GOAL_ICON, TOOL_COLOR, TOOL_DEFS } from '../render/toolDefs';
import { createToastManager, type ToastOptions } from './toast';

export interface HudUiState {
  selectedTool: ToolId | null;
  paused: boolean;
  speed: 1 | 2 | 4;
  scoreboardOpen: boolean;
  logOpen: boolean;
  /** best-known cost of the next hint (updated from ActionResult.hint.cost after each use);
   * a reasonable starting guess before the first hint is ever taken. */
  hintCost: number;
  clearedCollapsed: boolean;
}

export interface HudCallbacks {
  onSelectTool(tool: ToolId): void;
  onStart(): void; // Action{type:'start'}: intro -> playing
  onTogglePause(): void;
  onCycleSpeed(): void;
  onHint(): void; // Action{type:'hint'}
  onRestart(): void;
  onNewLayout(): void;
  onNextLevel(): void; // cleared banner: advance to the following level
  onLevels(): void; // back to level select
  onToggleScoreboard(): void;
  onToggleLog(): void;
  onToggleCleared(): void;
}

const KIND_LABEL: Record<string, string> = {
  cloud: 'Clouds', planet: 'Planets', star_ms: 'Main-sequence stars', star_giant: 'Red giants',
  white_dwarf: 'White dwarfs', neutron: 'Neutron stars', black_hole: 'Black holes',
};

function fmt(n: number): string {
  return n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function pillState(g: GoalStatus): 'met' | 'missed' | 'red' | 'amber' | '' {
  if (g.met) return 'met';
  if (g.missed) return 'missed';
  if (g.remainingSec < 10) return 'red';
  if (g.goal.deadlineSec > 0 && g.remainingSec < g.goal.deadlineSec * 0.25) return 'amber';
  return '';
}

export function createHud(root: HTMLElement, cb: HudCallbacks) {
  root.innerHTML = `
    <div class="layer" id="h-top-layer">
      <div class="topbar panel">
        <span class="level-name" id="h-level"></span>
        <span class="score" id="h-score"></span>
        <span class="energy" id="h-energy"></span>
        <span class="spacer-x"></span>
        <button class="icon-btn" id="h-menu-toggle" aria-label="Menu">&#8942;</button>
      </div>
      <div class="goal-strip" id="h-goal-strip"></div>
      <div class="dropdown panel" id="h-menu-drawer" hidden>
        <div class="menu-actions">
          <button id="h-log-toggle">Log</button>
          <button id="h-score-toggle">Scoreboard</button>
        </div>
        <div class="menu-actions">
          <button id="h-restart">Restart</button>
          <button id="h-newlayout">New layout</button>
          <button id="h-levels">Levels</button>
        </div>
        <div class="scoreboard-drawer" id="h-score-drawer" hidden></div>
        <div class="log-drawer" id="h-log-drawer-inner" hidden></div>
      </div>
      <div class="toast-stack" id="h-toasts"></div>
      <div class="popup-layer" id="h-popups"></div>
      <div class="cleared-banner panel" id="h-cleared" hidden></div>
    </div>
    <div class="spacer"></div>
    <div class="layer" id="h-bottom-layer">
      <div class="tool-strip panel" id="h-tool-strip" hidden></div>
      <div class="bottombar panel" id="h-bottombar">
        <div class="palette" id="h-palette"></div>
        <div class="controls" id="h-controls">
          <button class="ctrl-btn" id="h-playpause" aria-label="Pause/Play"></button>
          <button class="ctrl-btn speed-btn" id="h-speed" aria-label="Speed"></button>
          <button class="ctrl-btn hint-btn" id="h-hint" aria-label="Hint"></button>
        </div>
      </div>
    </div>
    <div id="h-overlay"></div>
  `;

  const el = {
    level: root.querySelector<HTMLElement>('#h-level')!,
    score: root.querySelector<HTMLElement>('#h-score')!,
    energy: root.querySelector<HTMLElement>('#h-energy')!,
    goalStrip: root.querySelector<HTMLElement>('#h-goal-strip')!,
    menuToggle: root.querySelector<HTMLButtonElement>('#h-menu-toggle')!,
    menuDrawer: root.querySelector<HTMLElement>('#h-menu-drawer')!,
    scoreToggle: root.querySelector<HTMLButtonElement>('#h-score-toggle')!,
    scoreDrawer: root.querySelector<HTMLElement>('#h-score-drawer')!,
    logToggle: root.querySelector<HTMLButtonElement>('#h-log-toggle')!,
    logDrawer: root.querySelector<HTMLElement>('#h-log-drawer-inner')!,
    restart: root.querySelector<HTMLButtonElement>('#h-restart')!,
    newLayout: root.querySelector<HTMLButtonElement>('#h-newlayout')!,
    levels: root.querySelector<HTMLButtonElement>('#h-levels')!,
    toolStrip: root.querySelector<HTMLElement>('#h-tool-strip')!,
    bottombar: root.querySelector<HTMLElement>('#h-bottombar')!,
    palette: root.querySelector<HTMLElement>('#h-palette')!,
    playPause: root.querySelector<HTMLButtonElement>('#h-playpause')!,
    speed: root.querySelector<HTMLButtonElement>('#h-speed')!,
    hint: root.querySelector<HTMLButtonElement>('#h-hint')!,
    cleared: root.querySelector<HTMLElement>('#h-cleared')!,
    overlay: root.querySelector<HTMLElement>('#h-overlay')!,
    toasts: root.querySelector<HTMLElement>('#h-toasts')!,
    popups: root.querySelector<HTMLElement>('#h-popups')!,
  };

  const toaster = createToastManager(el.toasts);

  let menuOpen = false;
  el.menuDrawer.hidden = true;
  el.menuToggle.addEventListener('click', (ev) => {
    ev.stopPropagation();
    menuOpen = !menuOpen;
    el.menuDrawer.hidden = !menuOpen;
  });
  root.addEventListener('click', () => {
    menuOpen = false;
    el.menuDrawer.hidden = true;
    hideGoalTooltip();
  });
  el.menuDrawer.addEventListener('click', (ev) => ev.stopPropagation());

  el.scoreToggle.addEventListener('click', () => cb.onToggleScoreboard());
  el.logToggle.addEventListener('click', () => cb.onToggleLog());
  el.restart.addEventListener('click', () => cb.onRestart());
  el.newLayout.addEventListener('click', () => cb.onNewLayout());
  el.levels.addEventListener('click', () => cb.onLevels());
  el.playPause.addEventListener('click', () => cb.onTogglePause());
  el.speed.addEventListener('click', () => cb.onCycleSpeed());
  el.hint.addEventListener('click', () => cb.onHint());

  let goalTooltipEl: HTMLElement | null = null;
  function hideGoalTooltip() {
    if (goalTooltipEl) { goalTooltipEl.remove(); goalTooltipEl = null; }
  }
  function showGoalTooltip(btn: HTMLElement, label: string) {
    hideGoalTooltip();
    const div = document.createElement('div');
    div.className = 'goal-tooltip panel';
    div.textContent = label;
    const r = btn.getBoundingClientRect();
    div.style.left = `${r.left + r.width / 2}px`;
    div.style.top = `${r.bottom + 6}px`;
    root.appendChild(div);
    goalTooltipEl = div;
    setTimeout(() => { if (goalTooltipEl === div) hideGoalTooltip(); }, 2600);
  }

  let lastPaletteKey = '';
  let lastPhase = '';
  let lastLogLine: string | null = null;
  let lastLogTime = 0;
  let lastLogRenderKey = '';
  let lastSelectedTool: ToolId | null = null;
  let lastGoalKey = '';
  let lastClearedShown = false;

  function renderScoreboardRows(state: GameState): string {
    const sb = state.scoreboard;
    const rows: string[] = [];
    rows.push(`<div class="k">Points</div><div class="v">${fmt(sb.points)}</div>`);
    rows.push(`<div class="k">— from clouds</div><div class="v">${fmt(sb.pointsBy.clouds)}</div>`);
    rows.push(`<div class="k">— from planets</div><div class="v">${fmt(sb.pointsBy.planets)}</div>`);
    rows.push(`<div class="k">— from stars</div><div class="v">${fmt(sb.pointsBy.stars)}</div>`);
    rows.push(`<div class="k">— from novae</div><div class="v">${fmt(sb.pointsBy.novae)}</div>`);
    rows.push(`<div class="k">— from elements</div><div class="v">${fmt(sb.pointsBy.elements)}</div>`);
    rows.push(`<div class="k">— from goals</div><div class="v">${fmt(sb.pointsBy.goals)}</div>`);
    rows.push(`<div class="k">— spent on hints</div><div class="v">−${fmt(sb.pointsBy.spentHints)}</div>`);
    rows.push(`<div class="k">Clouds formed</div><div class="v">${fmt(sb.cloudsFormed)}</div>`);
    for (const kind of Object.keys(sb.starsByKind)) {
      if (kind === 'cloud') continue;
      const n = sb.starsByKind[kind as keyof typeof sb.starsByKind];
      if (!n) continue;
      rows.push(`<div class="k">${KIND_LABEL[kind] ?? kind}</div><div class="v">${fmt(n)}</div>`);
    }
    rows.push(`<div class="k">Novae</div><div class="v">${fmt(sb.novae)}</div>`);
    for (const e of Object.keys(sb.elements)) {
      rows.push(`<div class="k">${e}</div><div class="v">${fmt(sb.elements[e as keyof typeof sb.elements])}</div>`);
    }
    return rows.join('');
  }

  function update(state: GameState, ui: HudUiState) {
    el.level.textContent = state.level.name;
    el.score.innerHTML = `<span class="score-icon">✦</span>${fmt(state.scoreboard.points)}`;
    el.energy.innerHTML = `⚡${Math.floor(state.energy)}<span class="income">+${state.level.incomePerSec}/s</span>`;

    // ---- goal countdown pill strip (part of the reserved HUD height — never over the board) ----
    const goalKey = state.goals
      .map((g) => `${g.current}|${g.met}|${g.missed}|${Math.ceil(g.remainingSec)}`)
      .join(';');
    if (goalKey !== lastGoalKey) {
      lastGoalKey = goalKey;
      el.goalStrip.hidden = state.goals.length === 0;
      el.goalStrip.innerHTML = state.goals
        .map((g, i) => {
          const st = pillState(g);
          const icon = GOAL_ICON[g.goal.type] ?? '★';
          const frac = g.goal.deadlineSec > 0 ? Math.max(0, Math.min(1, g.remainingSec / g.goal.deadlineSec)) : 0;
          const timer = g.met ? '✓' : g.missed ? '✕' : mmss(g.remainingSec);
          return `<button class="goal-pill ${st}" data-i="${i}" title="${g.goal.label}">
            <span class="gp-icon">${icon}</span>
            <span class="gp-body">
              <span class="gp-label">${g.goal.label}</span>
              <span class="gp-progress">${fmt(g.current)}/${g.goal.count}</span>
            </span>
            <span class="gp-timer">${timer}</span>
            <span class="gp-bar"><span class="gp-bar-fill" style="width:${frac * 100}%"></span></span>
          </button>`;
        })
        .join('');
      el.goalStrip.querySelectorAll<HTMLButtonElement>('.goal-pill').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const i = Number(btn.dataset.i);
          const g = state.goals[i];
          if (g) showGoalTooltip(btn, `${g.goal.label} — ${fmt(g.current)}/${g.goal.count}`);
        });
      });
    }

    // scoreboard / log drawer (inside the overflow menu)
    el.scoreDrawer.hidden = !ui.scoreboardOpen;
    if (ui.scoreboardOpen) el.scoreDrawer.innerHTML = `<div class="scorelist">${renderScoreboardRows(state)}</div>`;

    // The sim keeps only the last few log lines, so track the last line we saw (lines carry a
    // time prefix, so they're unique enough) instead of the log's length, which stops growing.
    const logNow = state.log;
    if (lastLogLine === null || state.time < lastLogTime) {
      // first render or a restart (clock went backwards): resync without toasting
    } else {
      const from = lastLogLine === '' ? 0 : logNow.lastIndexOf(lastLogLine) + 1;
      for (let i = Math.max(0, from); i < logNow.length; i++) {
        const line = logNow[i];
        const text = line.replace(/^\s*\d+(?:\.\d+)?s:\s*/, '');
        if (/^(Clock started|Hint\b)/i.test(text)) continue; // hints already toast with a Place-it button
        toaster.show(text, /missed/i.test(text) ? 'warn' : 'info');
      }
    }
    lastLogLine = logNow.length ? logNow[logNow.length - 1] : '';
    lastLogTime = state.time;
    el.logDrawer.hidden = !ui.logOpen;
    if (ui.logOpen) {
      const last8 = state.log.slice(-8);
      const key = last8.join('|');
      if (key !== lastLogRenderKey) {
        lastLogRenderKey = key;
        el.logDrawer.innerHTML = `<div class="loglist">${last8.map((l) => `<div class="logline">${l}</div>`).join('')}</div>`;
      }
    }

    // ---- palette ----
    const inPlay = state.phase === 'playing' || state.phase === 'cleared';
    el.bottombar.style.display = inPlay || state.phase === 'intro' ? 'flex' : 'none';
    if (!inPlay) el.toolStrip.hidden = true;

    if (inPlay) {
      // Rebuild the chip DOM only when the tool set/inventory/selection changes — energy trickles
      // in continuously now (income/sec), and rebuilding on every tick would detach chips out from
      // under an in-flight click/drag. Affordability (disabled + cost text) is patched in place
      // below every frame instead, cheaply.
      const paletteKey = `${ui.selectedTool}|${state.level.tools.join(',')}|${Object.keys(state.inventory).join(',')}`;
      if (paletteKey !== lastPaletteKey) {
        lastPaletteKey = paletteKey;
        const invTools = (Object.keys(state.inventory) as ToolId[]).filter(
          (t) => (state.inventory[t] ?? 0) > 0 && !state.level.tools.includes(t),
        );
        el.palette.innerHTML = [...state.level.tools, ...invTools]
          .map((tool) => {
            const def = TOOL_DEFS[tool];
            const selected = ui.selectedTool === tool;
            return `<button class="tool-chip${selected ? ' selected' : ''}" data-tool="${tool}" title="${def.description}">
              <span class="dot" style="background:${TOOL_COLOR[tool]}"></span>
              <span class="chip-name">${def.name}</span>
              <span class="chip-cost"></span>
            </button>`;
          })
          .join('');
        el.palette.querySelectorAll<HTMLButtonElement>('.tool-chip').forEach((btn) => {
          btn.addEventListener('click', () => cb.onSelectTool(btn.dataset.tool as ToolId));
        });
      }
      el.palette.querySelectorAll<HTMLButtonElement>('.tool-chip').forEach((btn) => {
        const tool = btn.dataset.tool as ToolId;
        const def = TOOL_DEFS[tool];
        const inv = state.inventory[tool] ?? 0;
        const affordable = inv > 0 || state.energy >= def.cost;
        btn.disabled = !affordable;
        const cost = btn.querySelector<HTMLElement>('.chip-cost');
        if (cost) cost.textContent = inv > 0 ? `free ×${inv}` : `⚡${def.cost}`;
      });

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

      // pause/play + speed + hint controls
      el.playPause.textContent = ui.paused ? '▶' : '⏸';
      el.playPause.classList.toggle('on', ui.paused);
      el.speed.textContent = `${ui.speed}×`;
      el.speed.classList.toggle('on', ui.speed !== 1);
      const canAffordHint = state.scoreboard.points >= ui.hintCost;
      el.hint.textContent = `💡 Hint −${ui.hintCost}`;
      el.hint.disabled = !canAffordHint;
      el.hint.title = canAffordHint
        ? 'Spend points for a suggested placement'
        : `Not enough points (have ${fmt(state.scoreboard.points)}, need ${ui.hintCost})`;
    }

    // ---- non-blocking cleared banner ----
    if (state.phase === 'cleared') {
      if (!lastClearedShown || el.cleared.dataset.collapsed !== String(ui.clearedCollapsed)) {
        lastClearedShown = true;
        el.cleared.hidden = false;
        el.cleared.dataset.collapsed = String(ui.clearedCollapsed);
        const stars = '★'.repeat(state.stars) + '☆'.repeat(Math.max(0, 3 - state.stars));
        if (ui.clearedCollapsed) {
          el.cleared.innerHTML = `<button class="cleared-collapsed" id="h-cleared-expand">${stars} Cleared ▸</button>`;
          el.cleared.querySelector('#h-cleared-expand')!.addEventListener('click', () => cb.onToggleCleared());
        } else {
          el.cleared.innerHTML = `
            <div class="cleared-row">
              <span class="cleared-text">Galaxy organized! ${stars} — keep going or move on</span>
              <button class="icon-btn" id="h-cleared-collapse">▾</button>
            </div>
            <div class="cleared-actions">
              <button class="btn-primary" id="h-cleared-next">Next level</button>
              <button class="btn-secondary" id="h-cleared-retry">Retry</button>
            </div>`;
          el.cleared.querySelector('#h-cleared-collapse')!.addEventListener('click', () => cb.onToggleCleared());
          el.cleared.querySelector('#h-cleared-next')!.addEventListener('click', () => cb.onNextLevel());
          el.cleared.querySelector('#h-cleared-retry')!.addEventListener('click', () => cb.onRestart());
        }
      }
    } else if (lastClearedShown) {
      lastClearedShown = false;
      el.cleared.hidden = true;
      el.cleared.innerHTML = '';
    }

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
    el.overlay.innerHTML = '';
  }

  /** A floating "+N"-style popup at a screen position (px, viewport-relative), for formation
   * events (new body, nova, goal met). Fades and rises, then removes itself. */
  function popup(x: number, y: number, text: string, cls = '') {
    const div = document.createElement('div');
    div.className = `score-popup ${cls}`;
    div.textContent = text;
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;
    el.popups.appendChild(div);
    requestAnimationFrame(() => div.classList.add('go'));
    setTimeout(() => div.remove(), 1300);
  }

  return { update, toast: (msg: string, opts?: 'info' | 'warn' | ToastOptions) => toaster.show(msg, opts), popup };
}

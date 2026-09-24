import './style.css';
import type { Game, GameFactory, LevelDef, ToolId } from './sim/types';
import type { WorldSize } from './sim/worldSize';
import { worldSizeForAspect } from './sim/worldSize';
import { createMockGame } from './render/mockGame';
import { createBackgroundRenderer } from './render/gl';
import { createSceneRenderer, type Preview } from './render/scene';
import type { Rect } from './render/layout';
import { createHud, type HudCallbacks, type HudUiState } from './ui/hud';
import { attachInput } from './ui/input';
import * as levelSource from './ui/levelSource';

/** Wall-clock seconds a round should take to play out at 1x speed. */
const ROUND_DURATION_SEC = 15;
const STORAGE_KEY = 'gravity-game:unlocked';
const INVENTORY_KEY = 'gravity-game:inventory';
/** Sanity ceiling only (corrupted localStorage etc); procedural levels make progress endless. */
const MAX_UNLOCKED = 100000;

type Inventory = Partial<Record<ToolId, number>>;
/** createGame's real signature (src/sim/game.ts) has a 3rd options arg — {inventory, world,
 * level} per the v0.2 contract (src/sim/types.ts) — that the shared GameFactory type doesn't
 * declare. */
type GameFactoryWithOpts = (
  levelId: number,
  seed?: number,
  opts?: { inventory?: Inventory; world?: WorldSize; level?: LevelDef },
) => Game;

function loadInventory(): Inventory {
  try {
    const raw = localStorage.getItem(INVENTORY_KEY);
    return raw ? (JSON.parse(raw) as Inventory) : {};
  } catch {
    return {};
  }
}

function saveInventory(inv: Inventory) {
  try {
    localStorage.setItem(INVENTORY_KEY, JSON.stringify(inv));
  } catch {
    /* localStorage unavailable; inventory just won't carry over */
  }
}

const FALLBACK_LEVELS: LevelDef[] = [
  { id: 1, name: 'First Light', intro: 'Repulsor, density — form 1 cloud.', seed: 1, particleCount: 0, initialMix: {}, rounds: 2, ticksPerRound: 600, startingEnergy: 0, incomePerRound: 0, ambientGravity: 0, tools: [], goals: [] },
  { id: 2, name: 'Nursery', intro: 'Wall, accretion — 2 clouds, 1 planet.', seed: 2, particleCount: 0, initialMix: {}, rounds: 3, ticksPerRound: 600, startingEnergy: 0, incomePerRound: 0, ambientGravity: 0, tools: [], goals: [] },
  { id: 3, name: 'Ignition', intro: 'Mass to star — ignite 1 star.', seed: 3, particleCount: 0, initialMix: {}, rounds: 3, ticksPerRound: 600, startingEnergy: 0, incomePerRound: 0, ambientGravity: 0, tools: [], goals: [] },
];

function getUnlocked(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) && v >= 1 ? Math.min(v, MAX_UNLOCKED) : 1;
  } catch {
    return 1;
  }
}

function setUnlocked(n: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    /* localStorage unavailable (private mode etc); progress just won't persist */
  }
}

function levelCardHTML(id: number, locked: boolean, name: string, blurb: string, extraClass = ''): string {
  return `<button class="level-card panel${locked ? ' locked' : ''}${extraClass}" data-id="${id}" ${
    locked ? 'disabled' : ''
  }>
    <span class="num">${id}</span>
    <span class="info"><span class="name">${name}</span><span class="sub">${blurb}</span></span>
    ${locked ? '<span class="lock">🔒</span>' : ''}
  </button>`;
}

function chartingCardHTML(id: number): string {
  return `<div class="level-card panel locked preview">
    <span class="num">${id}</span>
    <span class="info"><span class="name">Charting galaxy…</span><span class="sub">Generating a new region</span></span>
    <span class="spinner"></span>
  </div>`;
}

/** A locked look-ahead card: handcrafted levels show their real name; procedural ones show a
 * spinner until levelGenWorker.ts finishes generating them (prefetch is kicked off here too). */
function previewCardHTML(id: number, world: WorldSize, handcrafted: number, realLevels?: LevelDef[]): string {
  if (id <= handcrafted) {
    const def = realLevels?.find((l) => l.id === id);
    return levelCardHTML(id, true, def?.name ?? `Level ${id}`, def?.intro ?? '', ' preview');
  }
  const cached = levelSource.peek(id, world);
  if (cached) return levelCardHTML(id, true, cached.name, levelSource.goalSummary(cached), ' preview');
  levelSource.prefetch(id, world);
  return chartingCardHTML(id);
}

function renderLevelSelect(
  uiRoot: HTMLElement,
  unlocked: number,
  world: WorldSize,
  handcrafted: number,
  realLevels: LevelDef[] | undefined,
  onPick: (id: number) => void,
) {
  uiRoot.innerHTML = `
    <div class="level-select layer">
      <h1>Gravity Game</h1>
      <p class="subtitle">Squeeze the drifting dark into clouds, planets, and stars.</p>
      <div class="level-grid" id="ls-grid"></div>
    </div>`;
  const grid = uiRoot.querySelector<HTMLElement>('#ls-grid')!;
  const rows: string[] = [];
  for (let id = 1; id <= unlocked; id++) {
    if (id <= handcrafted) {
      const def = realLevels?.find((l) => l.id === id);
      rows.push(levelCardHTML(id, false, def?.name ?? `Level ${id}`, def?.intro ?? ''));
    } else {
      const cached = levelSource.peek(id, world);
      if (!cached) levelSource.prefetch(id, world);
      rows.push(levelCardHTML(id, false, cached?.name ?? `Level ${id}`, cached ? levelSource.goalSummary(cached) : 'Charting…'));
    }
  }
  rows.push(previewCardHTML(unlocked + 1, world, handcrafted, realLevels));
  rows.push(previewCardHTML(unlocked + 2, world, handcrafted, realLevels));
  grid.innerHTML = rows.join('');
  grid.querySelectorAll<HTMLButtonElement>('.level-card[data-id]:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => onPick(Number(btn.dataset.id)));
  });
}

interface Session {
  game: Game;
  tick(dtSec: number, timeSec: number, boardRect: Rect): void;
  dispose(): void;
}

const NOOP_HUD_CALLBACKS: HudCallbacks = {
  onSelectTool() {},
  onStart() {},
  onEndRound() {},
  onRestart() {},
  onNewLayout() {},
  onNextLevel() {},
  onLevels() {},
  onToggleSpeed() {},
  onToggleScoreboard() {},
  onToggleLog() {},
};

function createSession(
  game: Game,
  sceneCanvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  scene: ReturnType<typeof createSceneRenderer>,
  opts: { onWin: () => void; onNextLevel: () => void; onLevels: () => void; onNewLayout: () => void },
): Session {
  const uiState: HudUiState = { selectedTool: null, speed: 1, scoreboardOpen: false, logOpen: false };
  let preview: Preview = null;
  let tickAccum = 0;
  let wonHandled = false;
  let boardRect: Rect = { x: 0, y: 0, w: sceneCanvas.clientWidth || 1, h: sceneCanvas.clientHeight || 1 };

  const hud = createHud(uiRoot, {
    onSelectTool(tool: ToolId) {
      // re-tapping the already-selected card must NOT deselect it (bug: natural
      // "pick tool, place, pick tool again" rhythm used to silently no-op the next tap)
      uiState.selectedTool = tool;
    },
    onStart() {
      game.apply({ type: 'start' });
    },
    onEndRound() {
      game.apply({ type: 'endRound' });
    },
    onRestart() {
      game.apply({ type: 'restart' });
      wonHandled = false;
      uiState.selectedTool = null;
      tickAccum = 0;
    },
    onNewLayout() {
      opts.onNewLayout();
    },
    onNextLevel() {
      opts.onNextLevel();
    },
    onLevels() {
      opts.onLevels();
    },
    onToggleSpeed() {
      uiState.speed = uiState.speed === 1 ? 2 : 1;
    },
    onToggleScoreboard() {
      uiState.scoreboardOpen = !uiState.scoreboardOpen;
    },
    onToggleLog() {
      uiState.logOpen = !uiState.logOpen;
    },
  });

  let editHintShown = false;
  const input = attachInput(sceneCanvas, game, uiRoot, {
    getSelectedTool: () => uiState.selectedTool,
    getBoardRect: () => boardRect,
    onPlaced() {
      /* keep the tool selected so the player can place several in a row */
      if (!editHintShown && game.state().nodes.some((n) => n.placedRound === game.state().round)) {
        editHintShown = true;
        hud.toast('Tip: tap a node to remove it, or drag it to move it before you run the round', 'info');
      }
    },
    onPreview(p) {
      preview = p;
    },
    onHint(msg) {
      hud.toast(msg, 'info');
    },
    onRejected(reason) {
      hud.toast(reason, 'warn');
    },
  });

  function tick(dtSec: number, timeSec: number, rect: Rect) {
    boardRect = rect;
    const before = game.state();
    if (before.phase === 'running') {
      const ticksPerSecond = before.level.ticksPerRound / ROUND_DURATION_SEC;
      tickAccum += dtSec * ticksPerSecond * uiState.speed;
      const whole = Math.floor(tickAccum);
      if (whole > 0) {
        game.step(whole);
        tickAccum -= whole;
      }
    }
    const state = game.state();
    if (state.phase === 'won' && !wonHandled) {
      wonHandled = true;
      opts.onWin();
    }
    scene.render(state, timeSec, preview, boardRect);
    hud.update(state, uiState);
  }

  function dispose() {
    input.destroy();
  }

  return { game, tick, dispose };
}

async function boot() {
  const [gameModule, levelsModule] = await Promise.all([
    import('./sim/game').catch(() => null),
    import('./levels/levels').catch(() => null),
  ]);

  const realFactory = (gameModule as { createGame?: GameFactory } | null)?.createGame;
  const factory: GameFactory = realFactory ?? createMockGame;
  if (!realFactory) {
    console.info('[main] src/sim/game.ts not found yet — playing against the render mock.');
  }

  const realLevels = (levelsModule as { LEVELS?: LevelDef[] } | null)?.LEVELS ?? FALLBACK_LEVELS;

  const bgCanvas = document.getElementById('bg') as HTMLCanvasElement;
  const sceneCanvas = document.getElementById('scene') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;

  const bg = createBackgroundRenderer(bgCanvas);
  const scene = createSceneRenderer(sceneCanvas);

  function resizeAll() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    bg.resize(w, h, dpr);
    scene.resize(w, h, dpr);
  }
  window.addEventListener('resize', resizeAll);
  window.addEventListener('orientationchange', resizeAll);
  resizeAll();

  // Kept alive purely so the nebula shader has field data to render behind
  // the level-select menu and between sessions.
  let backdropGame: Game = factory(1);
  let session: Session | null = null;
  let unsubscribeLevelSelect: (() => void) | null = null;

  /** The screen area not covered by the HUD's top bar / bottom palette (measured live off the
   * actual DOM each frame), so the board is letterboxed away from HUD chrome at any viewport.
   * Anchored to `.topbar`/`#h-bottombar` specifically (not floating drawers/strips) so it
   * doesn't jitter when a dropdown or the tool-description strip opens. */
  function computeBoardRect(): Rect {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const topEl = uiRoot.querySelector<HTMLElement>('#h-top-layer .topbar');
    const botEl = uiRoot.querySelector<HTMLElement>('#h-bottombar');
    const topY = topEl ? topEl.getBoundingClientRect().bottom : 0;
    const botY = botEl ? botEl.getBoundingClientRect().top : h;
    const y = Math.max(0, topY);
    const bottom = Math.min(h, Math.max(y, botY));
    return { x: 0, y, w, h: Math.max(40, bottom - y) };
  }

  function showLevelSelect() {
    if (session) {
      backdropGame = session.game;
      session.dispose();
      session = null;
    }
    if (unsubscribeLevelSelect) {
      unsubscribeLevelSelect();
      unsubscribeLevelSelect = null;
    }
    sceneCanvas.style.display = 'none';
    const unlocked = getUnlocked();
    const world = worldSizeForAspect(window.innerWidth / window.innerHeight);
    const handcrafted = levelSource.handcraftedCount();
    levelSource.prefetch(unlocked + 1, world);
    levelSource.prefetch(unlocked + 2, world);
    const rerender = () =>
      renderLevelSelect(uiRoot, getUnlocked(), world, handcrafted, realLevels, (id) => void startLevel(id));
    rerender();
    // background generation for the look-ahead cards finishes async — re-render when it does,
    // without polling, and only while still on this screen.
    unsubscribeLevelSelect = levelSource.onGenerated(() => {
      if (!session) rerender();
    });
  }

  async function startLevel(id: number, seedOverride?: number) {
    if (unsubscribeLevelSelect) {
      unsubscribeLevelSelect();
      unsubscribeLevelSelect = null;
    }
    if (session) session.dispose();
    sceneCanvas.style.display = 'block';
    uiRoot.innerHTML = '';

    // Build the HUD DOM shell first (throwaway callbacks) purely to measure this viewport's
    // compact top/bottom bar heights, then size the world to exactly fill the space between
    // them (worldSizeForAspect keeps board area constant so difficulty stays comparable).
    createHud(uiRoot, NOOP_HUD_CALLBACKS);
    const boardRect = computeBoardRect();
    const world = worldSizeForAspect(boardRect.w / boardRect.h);

    const handcrafted = levelSource.handcraftedCount();
    const inventory = loadInventory();
    let generatedLevel: LevelDef | undefined;
    let seed: number;

    if (id <= handcrafted) {
      const def = realLevels?.find((l) => l.id === id);
      seed = seedOverride ?? def?.seed ?? ((Date.now() ^ (id * 7919)) >>> 0);
    } else {
      if (!levelSource.peek(id, world)) {
        const overlay = uiRoot.querySelector<HTMLElement>('#h-overlay');
        if (overlay) {
          overlay.innerHTML = `<div class="overlay"><div class="card panel"><h1>Charting galaxy…</h1><p>Generating level ${id}. This won't take long.</p></div></div>`;
        }
      }
      generatedLevel = await levelSource.getOrGenerate(id, world);
      seed = seedOverride ?? generatedLevel.seed;
    }

    let game: Game;
    try {
      game = (factory as GameFactoryWithOpts)(id, seed, { inventory, world, level: generatedLevel });
    } catch (err) {
      console.warn('[main] factory rejected level', id, err, '— falling back to the render mock');
      game = createMockGame(id, seed);
    }

    session = createSession(game, sceneCanvas, uiRoot, scene, {
      onWin: () => {
        const before = getUnlocked();
        if (id >= before) setUnlocked(id + 1);
        saveInventory(game.state().inventory);
        const after = getUnlocked();
        levelSource.prefetch(after + 1, world);
        levelSource.prefetch(after + 2, world);
      },
      onNextLevel: () => {
        void startLevel(id + 1);
      },
      onLevels: () => showLevelSelect(),
      onNewLayout: () => {
        if (id <= handcrafted) {
          const fresh = (Date.now() ^ (id * 7919) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
          void startLevel(id, fresh);
        } else {
          // Procedural levels are deterministic in (id, world) per the v0.2 contract — no seed
          // axis to re-roll — so "new layout" just restarts the same charted region.
          void startLevel(id);
        }
      },
    });
  }

  showLevelSelect();

  let last = performance.now();
  function frame(now: number) {
    const dtSec = Math.min(0.1, (now - last) / 1000);
    last = now;
    const timeSec = now / 1000;
    const bgGame = session ? session.game : backdropGame;
    const boardRect = session ? computeBoardRect() : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    bg.render(bgGame.state(), timeSec, boardRect);
    if (session) session.tick(dtSec, timeSec, boardRect);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error('[main] failed to start', err);
  const uiRoot = document.getElementById('ui');
  if (uiRoot) {
    uiRoot.innerHTML = `<div class="overlay"><div class="card panel"><h1>Failed to start</h1><p>${String(
      err,
    )}</p></div></div>`;
  }
});

import './style.css';
import type { Game, GameFactory, LevelDef, ToolId } from './sim/types';
import { TICKS_PER_SECOND } from './sim/types';
import type { WorldSize } from './sim/worldSize';
import { worldSizeForAspect } from './sim/worldSize';
import { createMockGameWithOpts } from './render/mockGame';
import { createBackgroundRenderer } from './render/gl';
import { createSceneRenderer, type Preview } from './render/scene';
import { computeLetterboxIn, worldToScreen, type Rect } from './render/layout';
import { createHud, type HudCallbacks, type HudUiState } from './ui/hud';
import { attachInput } from './ui/input';
import * as levelSource from './ui/levelSource';

const STORAGE_KEY = 'gravity-game:unlocked';
const INVENTORY_KEY = 'gravity-game:inventory';
const BEST_KEY = 'gravity-game:best';
/** Sanity ceiling only (corrupted localStorage etc); procedural levels make progress endless. */
const MAX_UNLOCKED = 100000;
/** Starting guess for the hint button's label before any hint has been taken this session. */
const DEFAULT_HINT_COST = 50;

type Inventory = Partial<Record<ToolId, number>>;
type Speed = 1 | 2 | 4;
interface Best { points: number; stars: number }

/** createGame's real signature (src/sim/game.ts) takes a 3rd options arg — {inventory, world,
 * level} per the contract (src/sim/types.ts GameOptions) — that the shared GameFactory type
 * doesn't declare. */
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

function loadBestAll(): Record<number, Best> {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as Record<number, Best>) : {};
  } catch {
    return {};
  }
}

function loadBest(levelId: number): Best | null {
  const all = loadBestAll();
  return all[levelId] ?? null;
}

function saveBest(levelId: number, points: number, stars: number) {
  try {
    const all = loadBestAll();
    const prev = all[levelId];
    if (!prev || points > prev.points || stars > prev.stars) {
      all[levelId] = { points: Math.max(points, prev?.points ?? 0), stars: Math.max(stars, prev?.stars ?? 0) };
      localStorage.setItem(BEST_KEY, JSON.stringify(all));
    }
  } catch {
    /* localStorage unavailable; best score just won't persist */
  }
}

const FALLBACK_LEVELS: LevelDef[] = [
  { id: 1, name: 'First Light', intro: 'Repulsor, density — form 1 cloud.', seed: 1, particleCount: 0, initialMix: {}, startingEnergy: 0, incomePerSec: 0, ambientGravity: 0, tools: [], goals: [] },
  { id: 2, name: 'Nursery', intro: 'Wall, accretion — 2 clouds, 1 planet.', seed: 2, particleCount: 0, initialMix: {}, startingEnergy: 0, incomePerSec: 0, ambientGravity: 0, tools: [], goals: [] },
  { id: 3, name: 'Ignition', intro: 'Mass to star — ignite 1 star.', seed: 3, particleCount: 0, initialMix: {}, startingEnergy: 0, incomePerSec: 0, ambientGravity: 0, tools: [], goals: [] },
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

function bestBadgeHTML(id: number): string {
  const best = loadBest(id);
  if (!best) return '';
  const stars = '★'.repeat(best.stars) + '☆'.repeat(Math.max(0, 3 - best.stars));
  return `<span class="best-badge">${stars} · ${Math.round(best.points)} pts</span>`;
}

function levelCardHTML(id: number, locked: boolean, name: string, blurb: string, extraClass = ''): string {
  return `<button class="level-card panel${locked ? ' locked' : ''}${extraClass}" data-id="${id}" ${
    locked ? 'disabled' : ''
  }>
    <span class="num">${id}</span>
    <span class="info"><span class="name">${name}</span><span class="sub">${blurb}</span>${bestBadgeHTML(id)}</span>
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
      <p class="subtitle">Squeeze the drifting dark into clouds, planets, and stars — the grid never stops.</p>
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
  onSelectTool() {}, onStart() {}, onTogglePause() {}, onCycleSpeed() {}, onHint() {},
  onRestart() {}, onNewLayout() {}, onNextLevel() {}, onLevels() {},
  onToggleScoreboard() {}, onToggleLog() {}, onToggleCleared() {},
};

function createSession(
  game: Game,
  sceneCanvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  scene: ReturnType<typeof createSceneRenderer>,
  opts: { onCleared: () => void; onNextLevel: () => void; onLevels: () => void; onNewLayout: () => void },
  getHintCost?: (g: Game) => number,
): Session {
  const uiState: HudUiState = {
    selectedTool: null, paused: false, speed: 1, scoreboardOpen: false, logOpen: false,
    hintCost: DEFAULT_HINT_COST, clearedCollapsed: false,
  };
  let preview: Preview = null;
  let tickAccum = 0;
  let clearedHandled = false;
  let boardRect: Rect = { x: 0, y: 0, w: sceneCanvas.clientWidth || 1, h: sceneCanvas.clientHeight || 1 };

  // ---- formation-event tracking, for floating "+N" popups (adapts to whatever the Game
  // exposes: new bodies, new nova events, and goals flipping to met — via state diffs) ----
  let prevBodyIds = new Set<number>();
  let prevPointsBy = { clouds: 0, planets: 0, stars: 0, novae: 0, elements: 0, goals: 0, spentHints: 0 };
  let prevGoalMet: boolean[] = [];
  const seenEvents = new Set<string>();

  const hud = createHud(uiRoot, {
    onSelectTool(tool: ToolId) {
      // re-tapping the already-selected card must NOT deselect it (bug: natural
      // "pick tool, place, pick tool again" rhythm used to silently no-op the next tap)
      uiState.selectedTool = tool;
    },
    onStart() {
      game.apply({ type: 'start' });
    },
    onTogglePause() {
      uiState.paused = !uiState.paused;
    },
    onCycleSpeed() {
      const order: Speed[] = [1, 2, 4];
      uiState.speed = order[(order.indexOf(uiState.speed) + 1) % order.length];
    },
    onHint() {
      const r = game.apply({ type: 'hint' });
      if (r.ok && r.hint) {
        uiState.hintCost = r.hint.cost;
        hud.toast(r.hint.reason, {
          kind: 'info',
          durationMs: 20000,
          action: {
            label: 'Place it',
            onClick: () => {
              const h = game.state().hint;
              if (!h) return;
              const pr = game.apply({ type: 'place', tool: h.tool, x: h.x, y: h.y, x2: h.x2, y2: h.y2 });
              if (!pr.ok) hud.toast(pr.reason ?? 'Cannot place there', 'warn');
            },
          },
        });
      } else {
        hud.toast(r.reason ?? 'Cannot use a hint right now', 'warn');
      }
    },
    onRestart() {
      game.apply({ type: 'restart' });
      clearedHandled = false;
      uiState.selectedTool = null;
      uiState.paused = false;
      uiState.clearedCollapsed = false;
      tickAccum = 0;
      prevBodyIds = new Set();
      prevGoalMet = [];
      seenEvents.clear();
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
    onToggleScoreboard() {
      uiState.scoreboardOpen = !uiState.scoreboardOpen;
    },
    onToggleLog() {
      uiState.logOpen = !uiState.logOpen;
    },
    onToggleCleared() {
      uiState.clearedCollapsed = !uiState.clearedCollapsed;
    },
  });

  let editHintShown = false;
  const input = attachInput(sceneCanvas, game, uiRoot, {
    getSelectedTool: () => uiState.selectedTool,
    getBoardRect: () => boardRect,
    onPlaced() {
      /* keep the tool selected so the player can place several in a row */
      const s = game.state();
      if (!editHintShown && s.nodes.some((n) => s.time - n.placedAt < 0.5)) {
        editHintShown = true;
        hud.toast('Tip: tap a node to remove it, or drag it to move it within a few seconds of placing', 'info');
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
    onHintConsumed() {
      hud.toast('Placed the suggestion.', 'info');
    },
  });

  /** Spawn a "+N" popup at a world position, converted to viewport px via the live letterbox. */
  function popupAtWorld(wx: number, wy: number, text: string, cls = '') {
    const lb = computeLetterboxIn(boardRect, game.state().width, game.state().height);
    const p = worldToScreen(wx, wy, lb);
    const rect = sceneCanvas.getBoundingClientRect();
    hud.popup(rect.left + p.x, rect.top + p.y, text, cls);
  }

  function popupAtGoalPill(i: number, text: string) {
    const btn = uiRoot.querySelector<HTMLElement>(`.goal-pill[data-i="${i}"]`);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    hud.popup(r.left + r.width / 2, r.top, text, 'goal');
  }

  function detectFormationEvents(state: ReturnType<Game['state']>) {
    const sb = state.scoreboard;
    const newBodies = state.bodies.filter((b) => !prevBodyIds.has(b.id));
    if (newBodies.length) {
      const clouds = newBodies.filter((b) => b.kind === 'cloud');
      const planets = newBodies.filter((b) => b.kind !== 'cloud' && b.kind !== 'star_ms' && b.kind !== 'star_giant' && b.kind !== 'white_dwarf' && b.kind !== 'neutron' && b.kind !== 'black_hole');
      const stars = newBodies.filter((b) => !clouds.includes(b) && !planets.includes(b));
      const dC = sb.pointsBy.clouds - prevPointsBy.clouds;
      const dP = sb.pointsBy.planets - prevPointsBy.planets;
      const dS = sb.pointsBy.stars - prevPointsBy.stars;
      for (const b of clouds) popupAtWorld(b.x, b.y, `+${Math.max(1, Math.round(dC / clouds.length))}`, 'cloud');
      for (const b of planets) popupAtWorld(b.x, b.y, `+${Math.max(1, Math.round(dP / planets.length))}`, 'planet');
      for (const b of stars) popupAtWorld(b.x, b.y, `+${Math.max(1, Math.round(dS / stars.length))}`, 'star');
    }
    prevBodyIds = new Set(state.bodies.map((b) => b.id));
    const dNova = sb.pointsBy.novae - prevPointsBy.novae;
    if (dNova > 0) {
      for (const ev of state.events) {
        const key = `${ev.t.toFixed(2)}|${ev.x.toFixed(1)}|${ev.y.toFixed(1)}`;
        if (seenEvents.has(key)) continue;
        seenEvents.add(key);
        popupAtWorld(ev.x, ev.y, `+${Math.round(dNova)}`, 'nova');
      }
    }
    state.goals.forEach((g, i) => {
      if (g.met && prevGoalMet[i] === false) popupAtGoalPill(i, `+${Math.round(sb.pointsBy.goals - (prevPointsBy.goals))} goal!`);
    });
    prevGoalMet = state.goals.map((g) => g.met);
    prevPointsBy = { ...sb.pointsBy };
  }

  function tick(dtSec: number, timeSec: number, rect: Rect) {
    boardRect = rect;
    const before = game.state();
    if ((before.phase === 'playing' || before.phase === 'cleared') && !uiState.paused) {
      tickAccum += dtSec * TICKS_PER_SECOND * uiState.speed;
      const whole = Math.floor(tickAccum);
      if (whole > 0) {
        game.step(whole);
        tickAccum -= whole;
      }
    }
    const state = game.state();
    if (getHintCost) {
      try { uiState.hintCost = getHintCost(game); } catch { /* keep the last known cost */ }
    }
    detectFormationEvents(state);
    if (state.phase === 'cleared' && !clearedHandled) {
      clearedHandled = true;
      saveBest(state.levelId, state.scoreboard.points, state.stars);
      opts.onCleared();
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
  const factory: GameFactory = realFactory ?? (createMockGameWithOpts as GameFactory);
  if (!realFactory) {
    console.info('[main] src/sim/game.ts not found yet — playing against the render mock.');
  }
  // The real sim exposes the exact cost of the *next* hint (src/sim/game.ts hintCostOf); when
  // present the Hint button's label/disabled state reads it directly instead of a guess.
  const hintCostOf = (gameModule as { hintCostOf?: (g: Game) => number } | null)?.hintCostOf;

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

  /** The screen area not covered by the HUD's top bar (incl. the goal countdown pill strip,
   * which is a normal-flow sibling of .topbar inside #h-top-layer — dropdowns/toasts/the
   * cleared banner are all position:absolute and don't add to this box) or the bottom palette
   * (measured live off the actual DOM each frame), so the board is always letterboxed away from
   * HUD chrome, at any viewport, and the goal pills never sit over the board. */
  function computeBoardRect(): Rect {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const topEl = uiRoot.querySelector<HTMLElement>('#h-top-layer');
    const botEl = uiRoot.querySelector<HTMLElement>('#h-bottombar');
    const topY = topEl ? topEl.getBoundingClientRect().bottom : 0;
    const botY = botEl ? botEl.getBoundingClientRect().top : h;
    const y = Math.max(0, topY);
    const bottom = Math.min(h, Math.max(y, botY));
    return { x: 0, y, w, h: Math.max(40, bottom - y) };
  }

  /** Build the HUD DOM shell (throwaway callbacks) to measure this viewport's top/bottom bar
   * heights, and size the world to exactly fill the space between them (worldSizeForAspect keeps
   * board area constant so difficulty stays comparable). Leaves the shell in uiRoot; callers
   * replace it. */
  function measureGameWorld() {
    uiRoot.innerHTML = '';
    createHud(uiRoot, NOOP_HUD_CALLBACKS);
    const boardRect = computeBoardRect();
    return worldSizeForAspect(boardRect.w / boardRect.h);
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
    // Same world size startLevel() will use (measured off a throwaway HUD shell), so the
    // procedural previews shown here are exactly the levels the player gets.
    const world = measureGameWorld();
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
    const world = measureGameWorld();

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
      game = createMockGameWithOpts(id, seed);
    }

    session = createSession(game, sceneCanvas, uiRoot, scene, {
      onCleared: () => {
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
          // Procedural levels are deterministic in (id, world) per the contract — no seed axis
          // to re-roll — so "new layout" just restarts the same charted region.
          void startLevel(id);
        }
      },
    }, hintCostOf);
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

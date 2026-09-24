import './style.css';
import type { Game, GameFactory, LevelDef, ToolId } from './sim/types';
import { createMockGame } from './render/mockGame';
import { createBackgroundRenderer } from './render/gl';
import { createSceneRenderer, type Preview } from './render/scene';
import { createHud, type HudUiState } from './ui/hud';
import { attachInput } from './ui/input';

/** Wall-clock seconds a round should take to play out at 1x speed. */
const ROUND_DURATION_SEC = 15;
const STORAGE_KEY = 'gravity-game:unlocked';
const LEVEL_COUNT = 5;

interface LevelSummary {
  id: number;
  name: string;
  rounds: number;
  blurb: string;
}

const FALLBACK_LEVELS: LevelSummary[] = [
  { id: 1, name: 'First Light', rounds: 2, blurb: 'Repulsor, density — form 1 cloud.' },
  { id: 2, name: 'Nursery', rounds: 3, blurb: 'Wall, accretion — 2 clouds, 1 planet.' },
  { id: 3, name: 'Ignition', rounds: 3, blurb: 'Mass to star — ignite 1 star.' },
  { id: 4, name: 'Forge', rounds: 4, blurb: 'Pulse, fusion timers — star + 40 helium.' },
  { id: 5, name: 'Nova', rounds: 5, blurb: 'Red giants, supernova — trigger a nova.' },
];

function getUnlocked(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) && v >= 1 ? Math.min(v, LEVEL_COUNT) : 1;
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

function renderLevelSelect(
  uiRoot: HTMLElement,
  levels: LevelSummary[],
  unlocked: number,
  onPick: (id: number) => void,
) {
  uiRoot.innerHTML = `
    <div class="level-select layer">
      <h1>Gravity Game</h1>
      <p class="subtitle">Squeeze the drifting dark into clouds, planets, and stars.</p>
      <div class="level-grid" id="ls-grid"></div>
    </div>`;
  const grid = uiRoot.querySelector<HTMLElement>('#ls-grid')!;
  grid.innerHTML = levels
    .map((lv) => {
      const locked = lv.id > unlocked;
      return `<button class="level-card panel${locked ? ' locked' : ''}" data-id="${lv.id}" ${
        locked ? 'disabled' : ''
      }>
        <span class="num">${lv.id}</span>
        <span class="info"><span class="name">${lv.name}</span><span class="sub">${lv.blurb}</span></span>
        ${locked ? '<span class="lock">🔒</span>' : ''}
      </button>`;
    })
    .join('');
  grid.querySelectorAll<HTMLButtonElement>('.level-card').forEach((btn) => {
    btn.addEventListener('click', () => onPick(Number(btn.dataset.id)));
  });
}

interface Session {
  game: Game;
  tick(dtSec: number, timeSec: number): void;
  dispose(): void;
}

function createSession(
  game: Game,
  sceneCanvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  scene: ReturnType<typeof createSceneRenderer>,
  opts: { onWin: () => void; onNextLevel: () => void; onLevels: () => void },
): Session {
  const uiState: HudUiState = { selectedTool: null, speed: 1, scoreboardOpen: false };
  let preview: Preview = null;
  let tickAccum = 0;
  let wonHandled = false;

  const hud = createHud(uiRoot, {
    onSelectTool(tool: ToolId) {
      uiState.selectedTool = uiState.selectedTool === tool ? null : tool;
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
  });

  const input = attachInput(sceneCanvas, game, uiRoot, {
    getSelectedTool: () => uiState.selectedTool,
    onPlaced() {
      /* keep the tool selected so the player can place several in a row */
    },
    onPreview(p) {
      preview = p;
    },
  });

  function tick(dtSec: number, timeSec: number) {
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
    scene.render(state, timeSec, preview);
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

  const realLevels = (levelsModule as { LEVELS?: LevelDef[] } | null)?.LEVELS;
  const levelSummaries: LevelSummary[] =
    realLevels && realLevels.length
      ? realLevels.map((l) => ({ id: l.id, name: l.name, rounds: l.rounds, blurb: l.intro }))
      : FALLBACK_LEVELS;

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

  function showLevelSelect() {
    if (session) {
      backdropGame = session.game;
      session.dispose();
      session = null;
    }
    sceneCanvas.style.display = 'none';
    renderLevelSelect(uiRoot, levelSummaries, getUnlocked(), (id) => startLevel(id));
  }

  function startLevel(id: number) {
    if (session) session.dispose();
    sceneCanvas.style.display = 'block';
    uiRoot.innerHTML = '';
    const game = factory(id, (Date.now() ^ (id * 7919)) >>> 0);
    session = createSession(game, sceneCanvas, uiRoot, scene, {
      onWin: () => {
        const unlocked = getUnlocked();
        if (id >= unlocked && id < LEVEL_COUNT) setUnlocked(id + 1);
      },
      onNextLevel: () => {
        if (id < LEVEL_COUNT) startLevel(id + 1);
        else showLevelSelect();
      },
      onLevels: () => showLevelSelect(),
    });
  }

  showLevelSelect();

  let last = performance.now();
  function frame(now: number) {
    const dtSec = Math.min(0.1, (now - last) / 1000);
    last = now;
    const timeSec = now / 1000;
    const bgGame = session ? session.game : backdropGame;
    bg.render(bgGame.state(), timeSec);
    if (session) session.tick(dtSec, timeSec);
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

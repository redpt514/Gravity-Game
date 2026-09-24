/** Pointer input: place tools, drag walls, tap nodes to remove (with confirm popover). */
import type { Game, GameState, Node as SimNode, ToolId } from '../sim/types';
import { computeLetterbox, screenToWorld, worldToScreen, type Letterbox } from '../render/layout';
import type { Preview } from '../render/scene';
import { TOOL_DEFS } from '../render/toolDefs';

export interface InputHandle {
  destroy(): void;
}

export interface InputCallbacks {
  getSelectedTool(): ToolId | null;
  /** called after a placement attempt is sent to the sim (success or not) */
  onPlaced(): void;
  onPreview(p: Preview): void;
}

const TOUCH_RADIUS_PX = 24;

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function hitTestNode(
  state: GameState,
  lb: Letterbox,
  sx: number,
  sy: number,
): SimNode | null {
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i];
    if (n.tool === 'wall' && n.x2 != null && n.y2 != null) {
      const p1 = worldToScreen(n.x, n.y, lb);
      const p2 = worldToScreen(n.x2, n.y2, lb);
      if (distToSegment(sx, sy, p1.x, p1.y, p2.x, p2.y) < TOUCH_RADIUS_PX) return n;
    } else {
      const p = worldToScreen(n.x, n.y, lb);
      const dx = sx - p.x;
      const dy = sy - p.y;
      if (dx * dx + dy * dy < TOUCH_RADIUS_PX * TOUCH_RADIUS_PX) return n;
    }
  }
  return null;
}

export function attachInput(
  canvas: HTMLCanvasElement,
  game: Game,
  uiRoot: HTMLElement,
  cb: InputCallbacks,
): InputHandle {
  let dragStart: { x: number; y: number } | null = null;
  let activePointerId: number | null = null;
  let popoverEl: HTMLElement | null = null;

  function removePopover() {
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
    }
  }

  function showRemovePopover(node: SimNode, sx: number, sy: number) {
    removePopover();
    const rect = canvas.getBoundingClientRect();
    const div = document.createElement('div');
    div.className = 'popover panel layer';
    div.style.left = `${rect.left + sx}px`;
    div.style.top = `${rect.top + sy - 6}px`;
    div.innerHTML = `<span style="align-self:center;font-size:12px;color:var(--text-dim);white-space:nowrap;">Remove ${TOOL_DEFS[node.tool].name}?</span><button id="pop-yes" class="confirm">Remove</button><button id="pop-no">Cancel</button>`;
    uiRoot.appendChild(div);
    div.querySelector('#pop-yes')!.addEventListener('click', (ev) => {
      ev.stopPropagation();
      game.apply({ type: 'remove', nodeId: node.id });
      removePopover();
    });
    div.querySelector('#pop-no')!.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removePopover();
    });
    popoverEl = div;
  }

  function toWorld(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    const state = game.state();
    const lb = computeLetterbox(rect.width, rect.height, state.width, state.height);
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { world: screenToWorld(sx, sy, lb), lb, state, sx, sy };
  }

  function onPointerDown(e: PointerEvent) {
    removePopover();
    const { world, lb, state, sx, sy } = toWorld(e.clientX, e.clientY);
    if (state.phase !== 'plan') return;
    const tool = cb.getSelectedTool();
    if (tool) {
      dragStart = world;
      activePointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const hit = hitTestNode(state, lb, sx, sy);
    if (hit) showRemovePopover(hit, sx, sy);
  }

  function onPointerMove(e: PointerEvent) {
    const tool = cb.getSelectedTool();
    const { world, state } = toWorld(e.clientX, e.clientY);
    if (!tool || state.phase !== 'plan') {
      cb.onPreview(null);
      return;
    }
    const def = TOOL_DEFS[tool];
    const inv = state.inventory[tool] ?? 0;
    const valid = inv > 0 || state.energy >= def.cost;
    if (tool === 'wall') {
      if (dragStart && activePointerId === e.pointerId) {
        cb.onPreview({ kind: 'wall', x1: dragStart.x, y1: dragStart.y, x2: world.x, y2: world.y, valid });
      } else {
        cb.onPreview(null);
      }
    } else {
      cb.onPreview({ kind: 'point', tool, x: world.x, y: world.y, radius: def.radius, valid });
    }
  }

  function endDrag(e: PointerEvent, place: boolean) {
    if (activePointerId !== e.pointerId) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    activePointerId = null;
    const tool = cb.getSelectedTool();
    const { world, state } = toWorld(e.clientX, e.clientY);
    if (place && tool && state.phase === 'plan' && dragStart) {
      if (tool === 'wall') {
        if (Math.hypot(world.x - dragStart.x, world.y - dragStart.y) > 2) {
          game.apply({ type: 'place', tool: 'wall', x: dragStart.x, y: dragStart.y, x2: world.x, y2: world.y });
          cb.onPlaced();
        }
      } else {
        game.apply({ type: 'place', tool, x: world.x, y: world.y });
        cb.onPlaced();
      }
    }
    dragStart = null;
    cb.onPreview(null);
  }

  const onPointerUp = (e: PointerEvent) => endDrag(e, true);
  const onPointerCancel = (e: PointerEvent) => endDrag(e, false);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  return {
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      removePopover();
    },
  };
}

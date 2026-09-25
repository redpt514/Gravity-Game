/** Pointer input: place tools, drag walls; tap a node to remove it, drag a fresh node (within
 * GRACE_SEC of placement) to move it. Also lets the player tap a hint's ghost placement (with
 * that tool selected) to accept it directly, without going through the toast's button. */
import type { Game, GameState, Node as SimNode, ToolId } from '../sim/types';
import { GRACE_SEC } from '../sim/types';
import { computeLetterboxIn, screenToWorld, worldToScreen, type Letterbox, type Rect } from '../render/layout';
import type { Preview } from '../render/scene';
import { TOOL_DEFS } from '../render/toolDefs';

export interface InputHandle {
  destroy(): void;
}

export interface InputCallbacks {
  getSelectedTool(): ToolId | null;
  /** the current screen-space area (px) the board is letterboxed into (not covered by HUD) */
  getBoardRect(): Rect;
  /** called after a placement/move/remove attempt is sent to the sim (success or not) */
  onPlaced(): void;
  onPreview(p: Preview): void;
  /** a tap on the empty board with no tool selected */
  onHint(msg: string): void;
  /** a placement/move/remove attempt was rejected by the sim (ActionResult.reason) */
  onRejected(reason: string): void;
  /** the player tapped/placed the active hint's ghost — clears it from the UI's perspective */
  onHintConsumed(): void;
}

const TOUCH_RADIUS_PX = 24;

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function hitTestNode(state: GameState, lb: Letterbox, sx: number, sy: number): SimNode | null {
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

/** True if a tap at (sx,sy) lands on the currently active hint ghost's geometry. */
function hitTestHint(state: GameState, lb: Letterbox, sx: number, sy: number): boolean {
  const h = state.hint;
  if (!h) return false;
  if (h.x2 !== undefined && h.y2 !== undefined) {
    const p1 = worldToScreen(h.x, h.y, lb);
    const p2 = worldToScreen(h.x2, h.y2, lb);
    return distToSegment(sx, sy, p1.x, p1.y, p2.x, p2.y) < TOUCH_RADIUS_PX;
  }
  const p = worldToScreen(h.x, h.y, lb);
  const dx = sx - p.x, dy = sy - p.y;
  return dx * dx + dy * dy < TOUCH_RADIUS_PX * TOUCH_RADIUS_PX;
}

export function attachInput(canvas: HTMLCanvasElement, game: Game, uiRoot: HTMLElement, cb: InputCallbacks): InputHandle {
  /** place: dragging out a new tool; node: pressed an existing node (tap = remove popover, drag = move) */
  type Gesture =
    | { kind: 'place'; start: { x: number; y: number } }
    | { kind: 'node'; node: SimNode; startWorld: { x: number; y: number }; sx: number; sy: number; moved: boolean };
  let gesture: Gesture | null = null;
  let activePointerId: number | null = null;
  let popoverEl: HTMLElement | null = null;
  const DRAG_THRESHOLD_PX = 8;

  /** Nodes within GRACE_SEC of placement are free to move/remove-for-refund; older ones can
   * still be removed (no refund) but not moved. */
  const isFresh = (node: SimNode, state: GameState) => state.time - node.placedAt <= GRACE_SEC;

  function removePopover() {
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
    }
  }

  function showRemovePopover(node: SimNode, sx: number, sy: number) {
    removePopover();
    const state = game.state();
    const def = TOOL_DEFS[node.tool];
    const fresh = isFresh(node, state);
    const refund = !fresh ? 'no refund' : node.free ? 'returns to inventory' : `+${def.cost} refund`;
    const tip = fresh ? 'or drag it to move' : 'grace period expired — placed earlier';
    const rect = canvas.getBoundingClientRect();
    const div = document.createElement('div');
    div.className = 'popover panel layer';
    div.style.left = `${rect.left + sx}px`;
    div.style.top = `${rect.top + sy - 6}px`;
    div.innerHTML = `<span style="align-self:center;font-size:12px;color:var(--text-dim);line-height:1.3;">Remove ${def.name}? <b style="color:var(--text)">${refund}</b><br>${tip}</span><button id="pop-yes" class="confirm">Remove</button><button id="pop-no">Cancel</button>`;
    uiRoot.appendChild(div);
    div.querySelector('#pop-yes')!.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const r = game.apply({ type: 'remove', nodeId: node.id });
      if (!r.ok) cb.onRejected(r.reason ?? 'Cannot remove');
      cb.onPlaced();
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
    const lb = computeLetterboxIn(cb.getBoardRect(), state.width, state.height);
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { world: screenToWorld(sx, sy, lb), lb, state, sx, sy };
  }

  function capture(e: PointerEvent) {
    activePointerId = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events may not be capturable */
    }
  }

  /** Where a dragged node would land, keeping the grab offset (walls translate as a whole). */
  function movedTarget(g: Extract<Gesture, { kind: 'node' }>, world: { x: number; y: number }) {
    const dx = world.x - g.startWorld.x;
    const dy = world.y - g.startWorld.y;
    const n = g.node;
    return {
      x: n.x + dx,
      y: n.y + dy,
      x2: n.x2 != null ? n.x2 + dx : undefined,
      y2: n.y2 != null ? n.y2 + dy : undefined,
    };
  }

  function onPointerDown(e: PointerEvent) {
    removePopover();
    const { world, lb, state, sx, sy } = toWorld(e.clientX, e.clientY);
    if (state.phase === 'intro') return;
    // A tap on the active hint ghost, with that tool selected, places it directly.
    if (state.hint && cb.getSelectedTool() === state.hint.tool && hitTestHint(state, lb, sx, sy)) {
      const h = state.hint;
      const r = game.apply({ type: 'place', tool: h.tool, x: h.x, y: h.y, x2: h.x2, y2: h.y2 });
      if (!r.ok) cb.onRejected(r.reason ?? 'Cannot place there');
      else cb.onHintConsumed();
      cb.onPlaced();
      return;
    }
    // Existing nodes take priority over placing, so a node can always be removed or moved.
    const hit = hitTestNode(state, lb, sx, sy);
    if (hit) {
      gesture = { kind: 'node', node: hit, startWorld: world, sx, sy, moved: false };
      capture(e);
      return;
    }
    const tool = cb.getSelectedTool();
    if (tool) {
      gesture = { kind: 'place', start: world };
      capture(e);
      return;
    }
    cb.onHint('Select a tool below');
  }

  function onPointerMove(e: PointerEvent) {
    const { world, state, sx, sy } = toWorld(e.clientX, e.clientY);
    if (state.phase === 'intro') {
      cb.onPreview(null);
      return;
    }
    if (gesture?.kind === 'node' && activePointerId === e.pointerId) {
      if (!gesture.moved && Math.hypot(sx - gesture.sx, sy - gesture.sy) > DRAG_THRESHOLD_PX) gesture.moved = true;
      if (!gesture.moved || !isFresh(gesture.node, state)) {
        cb.onPreview(null);
        return;
      }
      const t = movedTarget(gesture, world);
      const n = gesture.node;
      if (n.tool === 'wall' && t.x2 != null && t.y2 != null) {
        cb.onPreview({ kind: 'wall', x1: t.x, y1: t.y, x2: t.x2, y2: t.y2, valid: true });
      } else {
        cb.onPreview({ kind: 'point', tool: n.tool, x: t.x, y: t.y, radius: TOOL_DEFS[n.tool].radius, valid: true });
      }
      return;
    }
    const tool = cb.getSelectedTool();
    if (!tool) {
      cb.onPreview(null);
      return;
    }
    const def = TOOL_DEFS[tool];
    const inv = state.inventory[tool] ?? 0;
    const valid = inv > 0 || state.energy >= def.cost;
    if (tool === 'wall') {
      if (gesture?.kind === 'place' && activePointerId === e.pointerId) {
        cb.onPreview({ kind: 'wall', x1: gesture.start.x, y1: gesture.start.y, x2: world.x, y2: world.y, valid });
      } else {
        cb.onPreview(null);
      }
    } else {
      cb.onPreview({ kind: 'point', tool, x: world.x, y: world.y, radius: def.radius, valid });
    }
  }

  function endDrag(e: PointerEvent, commit: boolean) {
    if (activePointerId !== e.pointerId) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    activePointerId = null;
    const g = gesture;
    gesture = null;
    cb.onPreview(null);
    const { world, state } = toWorld(e.clientX, e.clientY);
    if (!commit || !g || state.phase === 'intro') return;

    if (g.kind === 'node') {
      if (!g.moved) {
        showRemovePopover(g.node, g.sx, g.sy);
        return;
      }
      if (!isFresh(g.node, state)) {
        cb.onRejected('Grace period expired — this node can no longer be moved. Tap it to remove.');
        return;
      }
      const t = movedTarget(g, world);
      const r = game.apply({ type: 'move', nodeId: g.node.id, ...t });
      if (!r.ok) cb.onRejected(r.reason ?? 'Cannot move there');
      cb.onPlaced();
      return;
    }

    const tool = cb.getSelectedTool();
    if (!tool) return;
    if (tool === 'wall') {
      if (Math.hypot(world.x - g.start.x, world.y - g.start.y) > 2) {
        const r = game.apply({ type: 'place', tool: 'wall', x: g.start.x, y: g.start.y, x2: world.x, y2: world.y });
        if (!r.ok) cb.onRejected(r.reason ?? 'Cannot place there');
        cb.onPlaced();
      }
    } else {
      const r = game.apply({ type: 'place', tool, x: world.x, y: world.y });
      if (!r.ok) cb.onRejected(r.reason ?? 'Cannot place there');
      cb.onPlaced();
    }
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

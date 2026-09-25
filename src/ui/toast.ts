/** Brief stacking toasts (event log entries, placement hints/rejections). Fade after ~4s by
 * default; a toast can carry an action button (e.g. the hint's "Place it") and a longer custom
 * lifetime tied to how long the thing it describes stays relevant. */
export interface ToastAction {
  label: string;
  onClick(): void;
}

export interface ToastOptions {
  kind?: 'info' | 'warn';
  durationMs?: number;
  action?: ToastAction;
}

export interface ToastManager {
  show(msg: string, kindOrOpts?: 'info' | 'warn' | ToastOptions): void;
}

const LIFETIME_MS = 4000;
const FADE_MS = 300;
const MAX_STACK = 5;

export function createToastManager(container: HTMLElement): ToastManager {
  function show(msg: string, kindOrOpts: 'info' | 'warn' | ToastOptions = 'info') {
    const opts: ToastOptions = typeof kindOrOpts === 'string' ? { kind: kindOrOpts } : kindOrOpts;
    const kind = opts.kind ?? 'info';
    const duration = opts.durationMs ?? LIFETIME_MS;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const text = document.createElement('span');
    text.textContent = msg;
    el.appendChild(text);
    if (opts.action) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = opts.action.label;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opts.action!.onClick();
        el.classList.remove('in');
        el.classList.add('out');
        setTimeout(() => el.remove(), FADE_MS);
      });
      el.appendChild(btn);
    }
    container.appendChild(el);
    // trigger the enter transition on the next frame
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      el.classList.add('out');
      setTimeout(() => el.remove(), FADE_MS);
    }, duration);
    while (container.children.length > MAX_STACK) {
      container.firstElementChild?.remove();
    }
  }
  return { show };
}

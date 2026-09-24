/** Brief stacking toasts (event log entries, placement hints/rejections). Fade after ~4s. */
export interface ToastManager {
  show(msg: string, kind?: 'info' | 'warn'): void;
}

const LIFETIME_MS = 4000;
const FADE_MS = 300;
const MAX_STACK = 5;

export function createToastManager(container: HTMLElement): ToastManager {
  function show(msg: string, kind: 'info' | 'warn' = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    container.appendChild(el);
    // trigger the enter transition on the next frame
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      el.classList.add('out');
      setTimeout(() => el.remove(), FADE_MS);
    }, LIFETIME_MS);
    while (container.children.length > MAX_STACK) {
      container.firstElementChild?.remove();
    }
  }
  return { show };
}

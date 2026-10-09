import { icon, type IconName } from './icons';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls = '', text = '', attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export const button = (label: string, testid: string, cls = ''): HTMLButtonElement =>
  el('button', cls, label, { type: 'button', 'data-testid': testid });

const SHIELDED = ['mousedown', 'touchstart', 'pointerdown', 'dblclick', 'contextmenu'];

/** Stops events from reaching MapLibre's pan/zoom handlers (wheel is left alone so zoom still works). */
export function shieldFromMap(e: HTMLElement): void {
  for (const t of SHIELDED) e.addEventListener(t, (ev) => ev.stopPropagation());
}

/** Same as `shieldFromMap`, as props to spread on a Preact element. */
const stop = (e: Event): void => e.stopPropagation();
export const shieldProps = {
  onMouseDown: stop, onTouchStart: stop, onPointerDown: stop, onDblClick: stop, onContextMenu: stop,
};

export const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Icon-only button with a tooltip (imperative version, for the MapLibre markers). */
export function iconButton(name: IconName, testid: string, title: string, cls = '', size = 14): HTMLButtonElement {
  const b = button('', testid, cls);
  b.append(icon(name, size));
  b.title = title;
  return b;
}

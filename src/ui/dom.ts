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

/** Stops events from reaching MapLibre's pan/zoom handlers (wheel is left alone so zoom still works). */
export function shieldFromMap(e: HTMLElement): void {
  for (const t of ['mousedown', 'touchstart', 'pointerdown', 'dblclick', 'contextmenu']) {
    e.addEventListener(t, (ev) => ev.stopPropagation());
  }
}

export const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Icon-only button with a tooltip. */
export function iconButton(name: IconName, testid: string, title: string, cls = '', size = 14): HTMLButtonElement {
  const b = button('', testid, cls);
  b.append(icon(name, size));
  b.title = title;
  return b;
}

/** Saves `text` as a file through a temporary link. */
export function download(name: string, text: string, type = 'application/json'): void {
  const a = el('a', '', '', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

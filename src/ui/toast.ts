import { el } from './dom';

let node: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, ms = 2200): void {
  if (!node) {
    node = el('div', 'toast', '', { 'data-testid': 'toast', role: 'status' });
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => node?.classList.remove('show'), ms);
}

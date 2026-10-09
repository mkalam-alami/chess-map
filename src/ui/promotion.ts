import { el } from './dom';

export type Promotion = 'q' | 'r' | 'b' | 'n';

/** Small 4-piece chooser laid over `container`; calls back with q/r/b/n, or null when dismissed. */
export function askPromotion(container: HTMLElement, color: 'white' | 'black', done: (p: Promotion | null) => void): void {
  const overlay = el('div', 'promo', '', { 'data-testid': 'promo' });
  const close = (p: Promotion | null): void => {
    overlay.remove();
    done(p);
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(null);
  });
  for (const [role, letter] of [['queen', 'q'], ['rook', 'r'], ['bishop', 'b'], ['knight', 'n']] as const) {
    const b = el('button', 'promo-choice', '', { type: 'button', 'data-testid': 'promo-' + letter, 'aria-label': role });
    const piece = document.createElement('piece');
    piece.className = color + ' ' + role;
    b.append(piece);
    b.addEventListener('click', () => close(letter));
    overlay.append(b);
  }
  container.append(overlay);
}

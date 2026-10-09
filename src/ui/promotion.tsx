import { render } from 'preact';

export type Promotion = 'q' | 'r' | 'b' | 'n';

const CHOICES = [['queen', 'q'], ['rook', 'r'], ['bishop', 'b'], ['knight', 'n']] as const;

/** Small 4-piece chooser laid over `container`; calls back with q/r/b/n, or null when dismissed. */
export function askPromotion(container: HTMLElement, color: 'white' | 'black', done: (p: Promotion | null) => void): void {
  const host = document.createElement('div');
  host.style.display = 'contents'; // the overlay positions itself against `container`
  const close = (p: Promotion | null): void => {
    render(null, host);
    host.remove();
    done(p);
  };
  render(
    <div class="promo" data-testid="promo" onClick={(e) => e.target === e.currentTarget && close(null)}>
      {CHOICES.map(([role, letter]) => (
        <button type="button" class="promo-choice" data-testid={`promo-${letter}`} aria-label={role} onClick={() => close(letter)}>
          <piece class={`${color} ${role}`} />
        </button>
      ))}
    </div>,
    host,
  );
  container.append(host);
}

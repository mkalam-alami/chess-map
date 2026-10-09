import { getState, setCentered } from '../store/store';
import { button, el } from './dom';
import { icon } from './icons';

/** "Back to board": shown only after the user panned away from the board (leaving centered mode). */
export function createRecenterButton(): { el: HTMLElement; update: () => void } {
  const b = button('', 'back-to-board', 'recenter');
  b.append(icon('crosshair', 18), el('span', 'label', 'Back to board'));
  b.title = 'Center the map on the board again';
  b.addEventListener('click', () => setCentered(true));
  return { el: b, update: () => void (b.hidden = getState().centered) };
}

import type { Place } from '../../../domain';
import { openPopover } from './overlay';
import { placeLinks } from './placeLinks';

/** Links about the board's place, as plain anchors opening in a new tab. */
export function openPlaceMenu(anchor: HTMLElement, place: Place): void {
  openPopover(anchor, (close) => (
    <div class="menu">
      {placeLinks(place).map((l) => (
        <a class="menu-item" href={l.url} target="_blank" rel="noopener noreferrer" data-testid={l.testid} onClick={close}>{l.label}</a>
      ))}
    </div>
  ));
}

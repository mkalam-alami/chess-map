import { openPopover } from './overlay';

export interface BoardMenuItem {
  label: string;
  testid: string;
  run: () => void;
  hidden?: boolean;
}

/** The board header's actions as a popover, for boards too small to show them as buttons. */
export function openBoardMenu(anchor: HTMLElement, items: () => BoardMenuItem[]): void {
  openPopover(anchor, (close) => (
    <div class="menu">
      {items().filter((i) => !i.hidden).map((i) => (
        <button type="button" class="menu-item" data-testid={i.testid} onClick={() => { close(); i.run(); }}>{i.label}</button>
      ))}
    </div>
  ));
}

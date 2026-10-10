import { type Locator, type Page } from '@playwright/test';

/** What sits on the map besides the board: pins, the placing buttons (touch) and the toast. */
export class MapView {
  readonly pins: Locator;
  readonly rootPin: Locator;
  readonly overviewPins: Locator;
  readonly placeConfirm: Locator;
  readonly placeCancel: Locator;
  readonly toast: Locator;

  constructor(private readonly page: Page) {
    this.pins = page.getByTestId('pin');
    this.rootPin = page.getByTestId('pin-root');
    this.overviewPins = page.getByTestId('pin-overview');
    this.placeConfirm = page.getByTestId('place-confirm');
    this.placeCancel = page.getByTestId('place-cancel');
    this.toast = page.getByTestId('toast');
  }

  pin = (index = 0) => this.pins.nth(index);
  pinLabel = (index = 0) => this.pin(index).locator('.pin-label');

  /** Clicks the label of a pin, which enters it. */
  enter = (index = 0) => this.pinLabel(index).click();

  /** Drags on empty map from (60, 300), which pans it. */
  async pan(): Promise<void> {
    await this.page.mouse.move(60, 300);
    await this.page.mouse.down();
    await this.page.mouse.move(160, 330, { steps: 6 });
    await this.page.mouse.up();
  }
}

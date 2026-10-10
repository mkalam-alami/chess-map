import { expect, type Locator, type Page } from '@playwright/test';

/** The bar above the map: mode, map switcher, place, current line and navigation. */
export class TopBar {
  readonly editMode: Locator;
  readonly exploreMode: Locator;
  readonly modeToggle: Locator;
  readonly mapSelect: Locator;
  readonly placeLabel: Locator;
  readonly line: Locator;
  readonly lineFuture: Locator;
  readonly lineMove: Locator;
  readonly moveCount: Locator;
  readonly pinToggle: Locator;
  readonly overviewToggle: Locator;
  readonly undoMove: Locator;

  constructor(private readonly page: Page) {
    const id = (t: string) => page.getByTestId(t);
    this.editMode = id('mode-edit');
    this.exploreMode = id('mode-explore');
    this.modeToggle = id('mode-toggle');
    this.mapSelect = id('map-select');
    this.placeLabel = id('place-label');
    this.line = id('line');
    this.lineFuture = id('line-future');
    this.lineMove = id('line-move');
    this.moveCount = id('move-count');
    this.pinToggle = id('pin-toggle');
    this.overviewToggle = id('overview-toggle');
    this.undoMove = id('undo-move');
  }

  edit = () => this.editMode.click();
  explore = () => this.exploreMode.click();

  async back(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await this.page.getByTestId('btn-back').click();
  }

  async forward(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await this.page.getByTestId('btn-forward').click();
  }

  /** Names of the maps in the switcher, in order. */
  mapNames = (): Promise<string[]> => this.mapSelect.locator('option').allTextContents();

  activeMapName = (): Promise<string> =>
    this.mapSelect.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? '');

  selectMap = (name: string) => this.mapSelect.selectOption({ label: name });

  async expectMode(mode: 'edit' | 'explore'): Promise<void> {
    await expect(this.modeToggle).toHaveAttribute('data-mode', mode);
  }
}

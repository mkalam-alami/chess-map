import { type Locator, type Page } from '@playwright/test';

/** The "set location" / "go to place" sheet. */
export class LocatePanel {
  readonly root: Locator;
  readonly title: Locator;
  readonly input: Locator;
  readonly ghost: Locator;
  readonly results: Locator;

  constructor(page: Page) {
    this.root = page.getByTestId('locate');
    this.title = page.getByTestId('locate-title');
    this.input = page.getByTestId('locate-input');
    this.ghost = page.getByTestId('locate-ghost');
    this.results = page.getByTestId('locate-result');
  }
}

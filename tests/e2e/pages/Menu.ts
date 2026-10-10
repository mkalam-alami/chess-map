import { type Locator, type Page } from '@playwright/test';

export interface UploadFile { name: string; mimeType: string; buffer: Buffer }

/** The ⋮ menu and the hidden file inputs behind its import items. */
export class Menu {
  readonly button: Locator;
  readonly importJsonInput: Locator;
  readonly importPgnInput: Locator;

  constructor(private readonly page: Page) {
    this.button = page.getByTestId('menu-button');
    this.importJsonInput = page.getByTestId('import-json-input');
    this.importPgnInput = page.getByTestId('import-pgn-input');
  }

  /** Opens the menu and clicks an item (`new-map`, `export-json`, `open-lichess`, ...). */
  async choose(item: string): Promise<void> {
    await this.button.click();
    await this.page.getByTestId(`menu-${item}`).click();
  }

  /** Chooses an export item and returns the download it triggers. */
  async download(item: 'export-json' | 'export-pgn') {
    const [download] = await Promise.all([this.page.waitForEvent('download'), this.choose(item)]);
    return download;
  }

  importJson = (file: string | UploadFile) => this.importJsonInput.setInputFiles(file);
  importPgn = (file: string | UploadFile) => this.importPgnInput.setInputFiles(file);
}

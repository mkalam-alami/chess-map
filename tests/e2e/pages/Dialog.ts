import { expect, type Locator, type Page } from '@playwright/test';

/** Confirmation and form dialogs. */
export class Dialog {
  readonly root: Locator;
  readonly ok: Locator;
  readonly cancel: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByTestId('dialog');
    this.ok = page.getByTestId('dialog-ok');
    this.cancel = page.getByTestId('dialog-cancel');
  }

  field = (name: string) => this.page.getByTestId(`field-${name}`);

  /** Confirms and waits for the dialog to go away. */
  async confirm(): Promise<void> {
    await this.ok.click();
    await expect(this.root).toBeHidden();
  }
}

import { expect, type Locator, type Page } from '@playwright/test';

export interface Box { x: number; y: number; width: number; height: number }

/** Centre of a square on the board box (white at the bottom). */
export const squareAt = (box: Box, sq: string): { x: number; y: number } => {
  const s = box.width / 8;
  return { x: box.x + (sq.charCodeAt(0) - 97 + 0.5) * s, y: box.y + (8 - Number(sq[1]) + 0.5) * s };
};

/** The chessground board and its header (close, note, locate, delete...). */
export class Board {
  readonly root: Locator;
  readonly card: Locator;
  readonly close: Locator;
  readonly delete: Locator;
  readonly erase: Locator;
  readonly circles: Locator;
  readonly note: Locator;
  readonly noteInput: Locator;
  readonly noteText: Locator;
  readonly locate: Locator;
  readonly handle: Locator;
  readonly grip: Locator;
  private readonly surface: Locator;

  constructor(private readonly page: Page) {
    const id = (t: string) => page.getByTestId(t);
    this.root = id('board');
    this.card = id('board-card');
    this.close = id('board-close');
    this.delete = id('board-delete');
    this.erase = id('board-erase');
    this.circles = page.locator('[data-testid="board"] svg.cg-shapes circle');
    this.note = id('board-note');
    this.noteInput = id('note-input');
    this.noteText = id('note-text');
    this.locate = id('board-locate');
    this.handle = page.locator('.board-handle');
    this.grip = page.locator('.board-handle .grip');
    this.surface = page.locator('[data-testid="board"] cg-board');
  }

  /** The map eases to the focused node; waits until the board has not moved for three consecutive samples. */
  async settled(): Promise<Box> {
    let prev = '';
    let still = 0;
    for (let i = 0; i < 60; i++) {
      const b = await this.surface.boundingBox();
      const cur = JSON.stringify(b);
      still = b && cur === prev ? still + 1 : 0;
      if (b && still >= 2) return b;
      prev = cur;
      await this.page.waitForTimeout(100);
    }
    throw new Error('board never settled');
  }

  /** Plays a move with two clicks (white at the bottom), clicking the destination once the origin shows as selected. */
  async playMove(from: string, to: string): Promise<void> {
    const box = await this.settled();
    const selected = this.page.locator('[data-testid="board"] square.selected');
    await expect(async () => {
      await this.page.mouse.click(squareAt(box, from).x, squareAt(box, from).y);
      await expect(selected).toHaveCount(1, { timeout: 500 });
    }).toPass({ timeout: 5000 });
    await this.page.mouse.click(squareAt(box, to).x, squareAt(box, to).y);
  }

  /** Draws a circle on a square with a right click. */
  async circle(sq: string): Promise<void> {
    const box = await this.settled();
    const { x, y } = squareAt(box, sq);
    await this.page.mouse.move(x, y);
    await this.page.mouse.down({ button: 'right' });
    await this.page.mouse.move(x + 1, y + 1); // chessground only commits a shape once the pointer has moved
    await this.page.mouse.up({ button: 'right' });
  }

  /** Same move by touch (two taps). */
  async tapMove(from: string, to: string): Promise<void> {
    const box = await this.settled();
    for (const sq of [from, to]) await this.page.touchscreen.tap(squareAt(box, sq).x, squareAt(box, sq).y);
  }

  /** Drags the header by (dx, dy) pixels, with a key held (Shift moves the whole branch). */
  async drag(dx: number, dy: number, key?: 'Shift'): Promise<void> {
    const grip = (await this.handle.boundingBox())!;
    const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    if (key) await this.page.keyboard.down(key);
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
    await this.page.mouse.up();
    if (key) await this.page.keyboard.up(key);
  }

  /** Writes a note from the header and closes the editor with Enter. */
  async writeNote(text: string): Promise<void> {
    await this.note.click();
    await this.noteInput.fill(text);
    await this.page.keyboard.press('Enter');
  }

  /** The board shows the start position (all pieces unmoved). */
  expectStartPosition = () => expect(this.root).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\//);

  orientation = () => this.root.evaluate((el) => (el.classList.contains('orientation-black') ? 'black' : 'white'));
}

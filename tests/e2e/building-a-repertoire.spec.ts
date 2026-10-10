import { expect, test } from './fixtures';
import {
  back, edit, enterPin, expectStartFen, forward, line, nodeCount, openApp, playMove, settled, snapshot, spawn, squareAt, twoLevels,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test.describe('playing moves', () => {
  test('a move spawns a pin on the map while the board stays on the current position', async ({ page }) => {
    await edit(page);
    await expect(page.getByTestId('mode-toggle')).toHaveAttribute('data-mode', 'edit');
    await spawn(page, 'e2', 'e4');
    const pin = page.getByTestId('pin');
    await expect(pin).toHaveCount(1);
    await expect(pin).toHaveAttribute('data-label', '1.e4');
    await expectStartFen(page); // the board did not advance
    await enterPin(page);
    await expect(page.getByTestId('board')).toHaveAttribute('data-fen', / b KQkq /);
  });

  test('alternatives played from the same position become sibling pins', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await spawn(page, 'd2', 'd4', 1);
    await expect(page.getByTestId('pin')).toHaveCount(2);
    await expect(page.getByTestId('pin').first()).toHaveAttribute('data-label', '1.e4');
    await expect(page.getByTestId('pin').nth(1)).toHaveAttribute('data-label', '1.d4');
  });

  test('carry-to-place: the pin lands where you click; Escape cancels', async ({ page }) => {
    const card = page.getByTestId('board-card');
    await edit(page);
    await playMove(page, 'd2', 'd4');
    await expect(card).toHaveClass(/placing/);
    await page.keyboard.press('Escape');
    await expect(card).not.toHaveClass(/placing/);
    await expect(page.getByTestId('pin')).toHaveCount(0);
    await expectStartFen(page);

    await playMove(page, 'd2', 'd4');
    const box = await settled(page);
    const at = { x: box.x - 200, y: box.y + box.height / 2 + 30 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
    const pin = page.getByTestId('pin');
    await expect(pin).toHaveCount(1);
    const pb = (await pin.boundingBox())!;
    expect(Math.abs(pb.x + pb.width / 2 - at.x)).toBeLessThan(20);
    expect(Math.abs(pb.y + pb.height - at.y)).toBeLessThan(30); // the tip sits at the click
  });
});

test.describe('recording a segment (Pin mode)', () => {
  test('Pin mode records a segment, replays it and undoes the last ply', async ({ page }) => {
    await edit(page);
    await page.getByTestId('pin-toggle').click();
    for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']] as const) await playMove(page, a, b);
    await expect(line(page)).toHaveText('1. e4 e5 2. Nf3');

    await back(page, 3);
    await expect(line(page)).toHaveText('');
    await forward(page, 3);
    await expect(line(page)).toHaveText('1. e4 e5 2. Nf3');

    await expect(page.getByTestId('undo-ply')).toBeEnabled();
    await page.getByTestId('undo-ply').click();
    await expect(line(page)).toHaveText('1. e4 e5');
  });

  test('back-to-back moves with no waits are not dropped', async ({ page }) => {
    await edit(page);
    await page.getByTestId('pin-toggle').click();
    await playMove(page, 'e2', 'e4'); // creates the pinned node and recenters; the following plies are appended in place
    const box = await settled(page);
    const at = (sq: string) => squareAt(box, sq);
    await page.mouse.move(at('e7').x, at('e7').y);
    await page.mouse.down();
    await page.mouse.move(at('e5').x, at('e5').y, { steps: 4 });
    await page.mouse.up();
    await page.mouse.click(at('g1').x, at('g1').y);
    await page.mouse.click(at('f3').x, at('f3').y);
    await expect(line(page)).toHaveText('1. e4 e5 2. Nf3');
  });

  test('Backspace and Ctrl+Z undo the last recorded ply', async ({ page }) => {
    await edit(page);
    await page.keyboard.press('p'); // the shortcut for the Pin button
    await expect(page.getByTestId('pin-toggle')).toHaveAttribute('aria-pressed', 'true');
    for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']] as const) await playMove(page, a, b);
    await expect(line(page)).toHaveText('1. e4 e5 2. Nf3');
    await page.keyboard.press('Backspace');
    await expect(line(page)).toHaveText('1. e4 e5');
    await page.keyboard.press('Control+z');
    await expect(line(page)).toHaveText('1. e4');
  });

  test('Undo ply is disabled while there is nothing to take back', async ({ page }) => {
    await edit(page);
    await expect(page.getByTestId('undo-ply')).toBeDisabled();
  });
});

test.describe('deleting a position', () => {
  test('asks first (trash or Delete key) and removes its subtree', async ({ page }) => {
    await twoLevels(page);
    expect(await nodeCount(page)).toBe(3);
    await enterPin(page);
    await page.getByTestId('board-delete').click();
    await expect(page.getByTestId('dialog')).toContainText('1 below');
    await page.getByTestId('dialog-cancel').click();
    expect(await nodeCount(page)).toBe(3);
    await page.keyboard.press('Delete');
    await page.keyboard.press('Enter'); // the confirm button has focus
    await expect.poll(() => nodeCount(page)).toBe(1);
    await expect(page.getByTestId('pin')).toHaveCount(0);
  });

  test('Escape in the confirmation keeps the position', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await enterPin(page);
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dialog')).toBeHidden();
    expect(await nodeCount(page)).toBe(2);
  });

  test('the start position cannot be deleted', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await expect(page.getByTestId('board-delete')).toBeHidden();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('dialog')).toBeHidden();
    expect(await nodeCount(page)).toBe(2);
  });
});

test.describe('notes', () => {
  test('the note editor: clicking inside moves the caret, Enter closes, Shift+Enter adds a line', async ({ page }) => {
    await edit(page);
    await page.getByTestId('board-note').click();
    const input = page.getByTestId('note-input');
    await input.fill('hello world');
    const box = (await input.boundingBox())!;
    await page.mouse.click(box.x + 30, box.y + 10); // inside the text
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await page.keyboard.type('X');
    await expect(input).toHaveValue(/^hel?.*X.+/); // inserted mid-text, not appended
    await page.keyboard.press('Shift+Enter');
    await expect(input).toBeVisible();
    expect(await input.inputValue()).toContain('\n');
    await page.keyboard.press('Enter');
    await expect(input).toBeHidden();
    await expect(page.getByTestId('note-text')).toContainText('world');
  });

  test('a note edited from the board header persists and shows under the board and on its pin', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await enterPin(page);
    await page.getByTestId('board-note').click();
    await page.getByTestId('note-input').fill('King pawn, Lisbon trip');
    await page.getByTestId('board').click({ position: { x: 5, y: 5 }, force: true }); // losing focus closes the editor
    await expect(page.getByTestId('note-input')).toBeHidden();
    await expect(page.getByTestId('note-text')).toContainText('King pawn, Lisbon trip');
    await page.getByTestId('note-edit').click(); // the pencil reopens it
    await expect(page.getByTestId('note-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await back(page);
    await expect(page.getByTestId('pin').locator('.pin-note')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('note-text')).toContainText('King pawn, Lisbon trip');
  });

  test('a note survives a reload', async ({ page }) => {
    await edit(page);
    await page.getByTestId('board-note').click();
    await page.getByTestId('note-input').fill('Start here');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await snapshot(page)).nodes[(await snapshot(page)).rootId]?.note).toBe('Start here');
    await page.reload();
    await expect(page.getByTestId('note-text')).toContainText('Start here');
  });
});

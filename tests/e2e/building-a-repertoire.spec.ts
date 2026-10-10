import { expect, test } from './fixtures';

test('build a repertoire: place moves, delete a branch, record a pinned line, undo, write a note', async ({ page, app }) => {
  const { topBar, board, map, dialog } = app;
  await app.open();
  await topBar.edit();

  // A played move is carried as a ghost pin: Escape drops it, a click places it.
  await board.playMove('d2', 'd4');
  await expect(board.card).toHaveClass(/placing/);
  await page.keyboard.press('Escape');
  await expect(map.pins).toHaveCount(0);
  await board.expectStartPosition();

  await app.spawn('e2', 'e4');
  await app.spawn('d2', 'd4', 1);
  await expect(map.pins).toHaveCount(2);
  await expect(map.pin(0)).toHaveAttribute('data-label', '1.e4');
  await expect(map.pin(1)).toHaveAttribute('data-label', '1.d4');
  await board.expectStartPosition(); // the board did not advance

  // Deleting asks first.
  await map.enter(0);
  await board.delete.click();
  await dialog.cancel.click();
  expect(await app.nodeCount()).toBe(3);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Enter'); // the confirm button has focus
  await expect.poll(() => app.nodeCount()).toBe(2);
  await expect(map.pins).toHaveCount(1);

  // Pin mode records a whole segment; Backspace takes the last move back.
  await page.keyboard.press('p');
  await expect(topBar.pinToggle).toHaveAttribute('aria-pressed', 'true');
  for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']] as const) await board.playMove(from, to);
  await expect(topBar.line).toHaveText('1. e4 e5 2. Nf3');
  await page.keyboard.press('Backspace');
  await expect(topBar.line).toHaveText('1. e4 e5');

  await board.writeNote('Open game');
  await expect(board.noteText).toContainText('Open game');
  await expect.poll(async () => Object.values((await app.snapshot()).nodes).some((n) => n.note === 'Open game')).toBe(true);

  // Right-click circles belong to the position: a left click does not erase them, only the eraser does.
  await expect(board.erase).toBeHidden();
  await board.circle('d4');
  await expect(board.circles).toHaveCount(1);
  await expect(board.erase).toBeVisible();
  await board.playMove('b1', 'c3'); // a click on the board (selecting a piece) keeps them
  await expect(board.circles).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowLeft');
  await expect(board.circles).toHaveCount(0);
  await expect(board.erase).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(board.circles).toHaveCount(1);
  await board.erase.click();
  await expect(board.circles).toHaveCount(0);
  await expect(board.erase).toBeHidden();
});

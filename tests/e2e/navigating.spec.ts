import { expect, test } from './fixtures';

test('step through a line, close and reopen boards, toggle the overview', async ({ page, app }) => {
  const { topBar, board, map } = app;
  await app.open();
  await app.buildTwoLevels();

  await map.enter();
  await expect(topBar.line).toHaveText('1. e4');
  await page.keyboard.press('ArrowLeft');
  await expect(topBar.line).toHaveText('');
  // after stepping back, the moves forward would replay stay in the header, muted and clickable
  await expect(topBar.lineFuture.first()).toBeVisible();
  await topBar.lineFuture.first().click();
  await expect(topBar.line).toHaveText('1. e4');

  await map.enter();
  await expect(topBar.line).toHaveText('1. e4 e5');
  await topBar.lineMove.first().click(); // the top bar jumps back to a move
  await expect(topBar.line).toHaveText('1. e4');
  await map.rootPin.click();
  await expect(topBar.line).toHaveText('');

  await expect(map.overviewPins).toHaveCount(1);
  await topBar.overviewToggle.click();
  await expect(map.overviewPins).toHaveCount(0);
  await topBar.overviewToggle.click();

  await board.close.click();
  await expect(board.root).toBeHidden();
  await page.keyboard.press('ArrowRight'); // navigating reopens it
  await expect(board.root).toBeVisible();
  await map.pan(); // leaving the board closes it
  await expect(board.root).toBeHidden();
});

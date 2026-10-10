import { expect, test } from './fixtures';

test('Explore follows the repertoire, snaps back out-of-book moves and offers no edit tools', async ({ page, app }) => {
  const { topBar, board, map, dialog } = app;
  await app.open();
  await topBar.edit();
  await app.spawn('e2', 'e4');
  await topBar.explore();

  await board.playMove('d2', 'd4');
  await expect(map.toast).toHaveText('Not in repertoire');
  await board.expectStartPosition();
  await expect(topBar.line).toHaveText('');

  await board.playMove('e2', 'e4');
  await expect(topBar.line).toHaveText('1. e4');

  await page.keyboard.press('p'); // edit shortcuts do nothing
  await expect(topBar.pinToggle).toBeHidden();
  await page.keyboard.press('Delete');
  await expect(dialog.root).toBeHidden();
  await expect(board.grip).toBeHidden();
});

import { expect, test } from './fixtures';

test('first visit opens in Edit; the repertoire and the Explore / Edit choice survive a reload', async ({ page, app }) => {
  const { topBar, board, map } = app;
  await app.open();
  await expect(topBar.editMode).toHaveAttribute('aria-checked', 'true');
  await board.expectStartPosition();
  await expect(topBar.line).toHaveText('');
  await expect(topBar.placeLabel).toHaveText('Testville, Testland');

  await page.keyboard.press('e');
  await topBar.expectMode('explore');
  await page.keyboard.press('e');
  await topBar.expectMode('edit');

  await app.spawn('e2', 'e4'); // a non-empty repertoire, so the empty-map default does not apply
  await expect.poll(async () => (await app.stored('chess-map:library'))?.includes('"e4"')).toBe(true); // debounced autosave
  await topBar.explore();
  await page.reload();
  await expect(topBar.exploreMode).toHaveAttribute('aria-checked', 'true');
  await expect(board.root).toBeHidden(); // a loaded repertoire opens as pins only
  await expect(map.pin()).toHaveAttribute('data-label', '1.e4');

  await topBar.edit();
  await page.reload();
  await expect(topBar.editMode).toHaveAttribute('aria-checked', 'true');
});

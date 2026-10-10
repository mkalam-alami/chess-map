import { expect, test } from './fixtures';
import type { ChessMapPage } from './pages/ChessMapPage';

async function newMap(app: ChessMapPage, name: string, playAs: 'white' | 'black'): Promise<void> {
  await app.menu.choose('new-map');
  await app.dialog.field('name').fill(name);
  await app.dialog.field('orientation').selectOption(playAs);
  await app.dialog.confirm();
}

test('create, switch, rename, duplicate, flip and delete maps; the library is saved', async ({ page, app }) => {
  const { topBar, board, map, menu, dialog } = app;
  await app.open();
  expect(await topBar.mapNames()).toEqual(['My repertoire']);
  await topBar.edit();
  await app.spawn('e2', 'e4');

  await newMap(app, 'Sicilian', 'black');
  expect(await topBar.mapNames()).toEqual(['My repertoire', 'Sicilian']);
  expect(await topBar.activeMapName()).toBe('Sicilian');
  await expect(map.pins).toHaveCount(0);
  expect(await board.orientation()).toBe('black');

  await menu.choose('rename-map');
  await dialog.field('name').fill('Najdorf');
  await page.keyboard.press('Enter');
  expect(await topBar.mapNames()).toEqual(['My repertoire', 'Najdorf']);

  await topBar.selectMap('My repertoire');
  await expect(map.pin()).toHaveAttribute('data-label', '1.e4'); // each map keeps its own repertoire

  await menu.choose('duplicate-map');
  expect(await topBar.activeMapName()).toBe('My repertoire (copy)');
  await expect(map.pin()).toHaveAttribute('data-label', '1.e4');

  await menu.choose('flip');
  await expect.poll(() => board.orientation()).toBe('black');
  await page.reload();
  await expect(map.overviewPins.first()).toBeVisible(); // a loaded repertoire opens as pins only
  expect(await topBar.activeMapName()).toBe('My repertoire (copy)');
  await map.rootPin.click();
  expect(await board.orientation()).toBe('black');

  await menu.choose('delete-map');
  await dialog.cancel.click();
  expect(await topBar.mapNames()).toHaveLength(3);
  await menu.choose('delete-map');
  await dialog.confirm();
  expect(await topBar.mapNames()).toEqual(['My repertoire', 'Najdorf']);
});

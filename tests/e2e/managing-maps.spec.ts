import { expect, test } from './fixtures';
import { activeMapName, edit, expectStartFen, line, mapNames, menu, openApp, spawn } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const orientation = (page: import('@playwright/test').Page) =>
  page.getByTestId('board').evaluate((el) => (el.classList.contains('orientation-black') ? 'black' : 'white'));

/** The library is saved a moment after a change; leaving the page flushes it. */
async function reload(page: import('@playwright/test').Page): Promise<void> {
  await page.reload();
  await expect(page.getByTestId('board')).toBeVisible();
}

async function newMap(page: import('@playwright/test').Page, name: string, playAs: 'white' | 'black' = 'white'): Promise<void> {
  await menu(page, 'new-map');
  await page.getByTestId('field-name').fill(name);
  await page.getByTestId('field-orientation').selectOption(playAs);
  await page.getByTestId('dialog-ok').click();
  await expect(page.getByTestId('dialog')).toBeHidden();
}

test('a fresh library has one map, named "My repertoire"', async ({ page }) => {
  expect(await mapNames(page)).toEqual(['My repertoire']);
});

test.describe('creating a map', () => {
  test('asks for a name and who you play as, then opens the empty map in Edit', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await newMap(page, 'Sicilian', 'black');
    expect(await mapNames(page)).toEqual(['My repertoire', 'Sicilian']);
    expect(await activeMapName(page)).toBe('Sicilian');
    await expect(page.getByTestId('mode-edit')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('pin')).toHaveCount(0);
    await expectStartFen(page);
    expect(await orientation(page)).toBe('black');
  });

  test('Escape in the dialog creates nothing', async ({ page }) => {
    await menu(page, 'new-map');
    await expect(page.getByTestId('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dialog')).toBeHidden();
    expect(await mapNames(page)).toEqual(['My repertoire']);
  });

  test('a blank name becomes "Untitled"', async ({ page }) => {
    await newMap(page, '   ');
    expect(await mapNames(page)).toEqual(['My repertoire', 'Untitled']);
  });

  test('the new map is saved', async ({ page }) => {
    await newMap(page, 'Caro-Kann', 'black');
    await reload(page);
    expect(await mapNames(page)).toEqual(['My repertoire', 'Caro-Kann']);
    expect(await activeMapName(page)).toBe('Caro-Kann');
    expect(await orientation(page)).toBe('black');
  });
});

test.describe('renaming, flipping and duplicating', () => {
  test('rename changes the map name in the switcher, and it is saved', async ({ page }) => {
    await menu(page, 'rename-map');
    await expect(page.getByTestId('field-name')).toHaveValue('My repertoire');
    await page.getByTestId('field-name').fill('Italian Game');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('dialog')).toBeHidden();
    expect(await mapNames(page)).toEqual(['Italian Game']);
    await reload(page);
    expect(await mapNames(page)).toEqual(['Italian Game']);
  });

  test('flip orientation turns the board around, and it is saved', async ({ page }) => {
    expect(await orientation(page)).toBe('white');
    await menu(page, 'flip');
    await expect.poll(() => orientation(page)).toBe('black');
    await reload(page);
    expect(await orientation(page)).toBe('black');
    await menu(page, 'flip');
    await expect.poll(() => orientation(page)).toBe('white');
  });

  test('duplicate copies the repertoire into "<name> (copy)" and opens it', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await menu(page, 'duplicate-map');
    expect(await mapNames(page)).toEqual(['My repertoire', 'My repertoire (copy)']);
    expect(await activeMapName(page)).toBe('My repertoire (copy)');
    await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.e4');
    // the copy is independent: changing it leaves the original alone
    await spawn(page, 'd2', 'd4', 1);
    await expect(page.getByTestId('pin')).toHaveCount(2);
    await page.getByTestId('map-select').selectOption({ label: 'My repertoire' });
    await expect(page.getByTestId('pin')).toHaveCount(1);
  });
});

test.describe('switching maps', () => {
  test('each map keeps its own repertoire and its own start', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await newMap(page, 'Queen\'s pawn');
    await spawn(page, 'd2', 'd4');
    await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.d4');

    await page.getByTestId('map-select').selectOption({ label: 'My repertoire' });
    await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.e4');
    await expect(line(page)).toHaveText('');
    await page.getByTestId('map-select').selectOption({ label: 'Queen\'s pawn' });
    await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.d4');
  });

  test('the map you were on is the one you come back to', async ({ page }) => {
    await newMap(page, 'Second');
    await page.getByTestId('map-select').selectOption({ label: 'My repertoire' });
    await reload(page);
    expect(await activeMapName(page)).toBe('My repertoire');
    expect(await mapNames(page)).toEqual(['My repertoire', 'Second']);
  });
});

test.describe('deleting a map', () => {
  test('asks first, then removes it and falls back to another map', async ({ page }) => {
    await newMap(page, 'Throwaway');
    await menu(page, 'delete-map');
    await expect(page.getByTestId('dialog')).toContainText('Delete map "Throwaway"?');
    await page.getByTestId('dialog-cancel').click();
    expect(await mapNames(page)).toEqual(['My repertoire', 'Throwaway']);

    await menu(page, 'delete-map');
    await page.getByTestId('dialog-ok').click();
    expect(await mapNames(page)).toEqual(['My repertoire']);
    expect(await activeMapName(page)).toBe('My repertoire');
    await reload(page);
    expect(await mapNames(page)).toEqual(['My repertoire']);
  });

  test('the last map cannot be deleted', async ({ page }) => {
    await menu(page, 'delete-map');
    await expect(page.getByTestId('toast')).toHaveText('Cannot delete the last map');
    await expect(page.getByTestId('dialog')).toBeHidden();
    expect(await mapNames(page)).toEqual(['My repertoire']);
  });
});

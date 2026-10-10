import { expect, test } from './fixtures';
import { edit, expectStartFen, explore, line, openApp, spawn } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('first visit: an empty repertoire opens in Edit on the start position, with its place named', async ({ page }) => {
  await expect(page.getByTestId('mode-edit')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-testid="board"] cg-board')).toBeVisible();
  await expectStartFen(page);
  await expect(line(page)).toHaveText('');
  await expect(page.getByTestId('place-label')).toHaveText('Testville, Testland');
});

test('the Explore / Edit choice is remembered across reloads', async ({ page }) => {
  await edit(page);
  await spawn(page, 'e2', 'e4'); // a non-empty repertoire, so the empty-map default does not apply
  await expect.poll(() => page.evaluate(() => localStorage.getItem('chess-map:library')?.includes('"e4"'))).toBe(true); // debounced autosave
  await explore(page);
  await page.reload();
  await expect(page.getByTestId('mode-explore')).toHaveAttribute('aria-checked', 'true');
  await edit(page);
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toHaveAttribute('aria-checked', 'true');
});

test('the repertoire is still there after a reload', async ({ page }) => {
  await edit(page);
  await spawn(page, 'e2', 'e4');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('chess-map:library')?.includes('"e4"'))).toBe(true);
  await page.reload();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.e4');
});

test('keys E toggles between Explore and Edit', async ({ page }) => {
  await expect(page.getByTestId('mode-toggle')).toHaveAttribute('data-mode', 'edit');
  await page.keyboard.press('e');
  await expect(page.getByTestId('mode-toggle')).toHaveAttribute('data-mode', 'explore');
  await page.keyboard.press('e');
  await expect(page.getByTestId('mode-toggle')).toHaveAttribute('data-mode', 'edit');
});

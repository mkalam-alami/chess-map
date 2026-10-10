import { expect, test } from './fixtures';
import { edit, enterPin, expectStartFen, explore, line, nodeCount, openApp, playMove, spawn } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('a move outside the repertoire snaps back with a toast', async ({ page }) => {
  await explore(page);
  await playMove(page, 'd2', 'd4');
  await expect(page.getByTestId('toast')).toHaveText('Not in repertoire');
  await expectStartFen(page);
  await expect(line(page)).toHaveText('');
});

test.describe('with a repertoire', () => {
  test.beforeEach(async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await explore(page);
  });

  test('playing a move of the repertoire follows it', async ({ page }) => {
    await playMove(page, 'e2', 'e4');
    await expect(line(page)).toHaveText('1. e4');
    await expect(page.getByTestId('toast')).not.toHaveClass(/show/);
    await expect(page.getByTestId('board')).toHaveAttribute('data-fen', / b KQkq /);
  });

  test('another move snaps back, whatever the position', async ({ page }) => {
    await playMove(page, 'd2', 'd4');
    await expect(page.getByTestId('toast')).toHaveText('Not in repertoire');
    await expectStartFen(page);
    await playMove(page, 'e2', 'e4'); // the right one still works afterwards
    await expect(line(page)).toHaveText('1. e4');
    await playMove(page, 'a7', 'a6');
    await expect(page.getByTestId('toast')).toHaveText('Not in repertoire');
    await expect(line(page)).toHaveText('1. e4');
  });

  test('pins can be entered by clicking them', async ({ page }) => {
    await enterPin(page);
    await expect(line(page)).toHaveText('1. e4');
  });

  test('the board handle shows no drag hint or edit buttons', async ({ page }) => {
    await expect(page.getByTestId('board-locate')).toBeHidden();
    await expect(page.locator('.board-handle .grip')).toBeHidden();
    await expect(page.getByTestId('board-more')).toBeHidden();
    await edit(page);
    // This board is small (a child of the start board): the header keeps close and a "…" menu with the other actions.
    await expect(page.getByTestId('board-locate')).toBeHidden();
    await expect(page.getByTestId('board-close')).toBeVisible();
    await expect(page.getByTestId('board-more')).toBeVisible();
    await expect(page.getByTestId('pin-toggle')).toBeVisible();
    await explore(page);
    await expect(page.getByTestId('pin-toggle')).toBeHidden();
  });

  test('on a small board the "…" menu gives access to the header actions', async ({ page }) => {
    await edit(page);
    await page.getByTestId('board-more').click();
    await page.getByTestId('board-more-locate').click();
    await expect(page.getByTestId('locate-title')).toBeVisible();
  });

  test('edit shortcuts do nothing: no pin mode, no deletion', async ({ page }) => {
    await enterPin(page);
    await page.keyboard.press('p');
    await expect(page.getByTestId('pin-toggle')).toBeHidden();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('dialog')).toBeHidden();
    expect(await nodeCount(page)).toBe(2);
  });
});

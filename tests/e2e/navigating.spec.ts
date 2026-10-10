import { expect, test } from './fixtures';
import {
  back, edit, enterPin, forward, line, openApp, panMap, playMove, settled, snapshot, spawn, twoLevels,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test.describe('stepping through a line', () => {
  test('clicking a pin enters it; back and forward (buttons, then arrow keys) navigate', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await expect(page.getByTestId('move-count')).toHaveText('Start');
    await enterPin(page);
    await expect(line(page)).toHaveText('1. e4');
    await expect(page.getByTestId('move-count')).toHaveText('1.e4');

    await back(page);
    await expect(line(page)).toHaveText('');
    await forward(page);
    await expect(line(page)).toHaveText('1. e4');

    await page.keyboard.press('ArrowLeft');
    await expect(line(page)).toHaveText('');
    await page.keyboard.press('ArrowRight');
    await expect(line(page)).toHaveText('1. e4');
  });

  test('forward at the end of a line stays where it is', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await enterPin(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(line(page)).toHaveText('1. e4');
    await back(page);
    await expect(line(page)).toHaveText('');
  });

  test('clicking a move in the top bar jumps back to it', async ({ page }) => {
    await edit(page);
    await page.getByTestId('pin-toggle').click();
    for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']] as const) await playMove(page, a, b);
    await page.getByTestId('line-move').first().click();
    await expect(page.getByTestId('move-count')).toHaveText('1.e4');
    await expect(page.getByTestId('board')).toHaveAttribute('data-fen', / b KQkq /);
  });

  test('the start pin leads back to the start from anywhere', async ({ page }) => {
    await twoLevels(page);
    await enterPin(page);
    await enterPin(page);
    await expect(line(page)).toHaveText('1. e4 e5');
    await page.getByTestId('pin-root').click();
    await expect(line(page)).toHaveText('');
  });
});

test.describe('boards', () => {
  test('every board can be closed, the root included; its pin reopens it', async ({ page }) => {
    const card = page.getByTestId('board-card');
    await page.getByTestId('board-close').click();
    await expect(card).toBeHidden();
    await page.getByTestId('pin-root').click();
    await expect(card).toBeVisible();
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await enterPin(page);
    await page.getByTestId('board-close').click();
    await expect(card).toBeHidden();
    await page.keyboard.press('ArrowLeft'); // navigating reopens it
    await expect(card).toBeVisible();
  });

  test('centered mode: zoom stays on the board; panning away closes the board', async ({ page }) => {
    const backToBoard = page.getByTestId('back-to-board');
    await expect(backToBoard).toBeHidden();
    await settled(page);
    const c0 = (await snapshot(page)).center;
    await page.mouse.move(60, 300);
    await page.mouse.wheel(0, -300); // zoom in with the pointer far from the board
    await page.waitForTimeout(500); // checks an absence: the camera must not drift away from the board
    const c1 = (await snapshot(page)).center;
    expect(c1[0]).toBeCloseTo(c0[0], 5);
    expect(c1[1]).toBeCloseTo(c0[1], 5);
    await panMap(page); // leaving the board closes it, so there is nothing to go back to
    await expect(page.getByTestId('board')).toBeHidden();
    await expect(backToBoard).toBeHidden();
  });
});

test.describe('seeing the whole repertoire', () => {
  test('overview shows the whole tree faded', async ({ page }) => {
    await twoLevels(page);
    const faded = page.getByTestId('pin-overview');
    await expect(faded).toHaveCount(1); // on by default
    await page.getByTestId('overview-toggle').click();
    await expect(faded).toHaveCount(0);
    await page.getByTestId('overview-toggle').click();
    await expect(faded).toHaveCount(1);
  });

  test('a transposition chip links to the other route', async ({ page }) => {
    const chip = page.getByTestId('transposition');
    await edit(page);
    await page.getByTestId('pin-toggle').click();
    for (const [a, b] of [['g1', 'f3'], ['g8', 'f6'], ['b1', 'c3']] as const) await playMove(page, a, b);
    await expect(line(page)).toHaveText('1. Nf3 Nf6 2. Nc3');
    await expect(chip).toBeHidden();
    await back(page, 3);
    for (const [a, b] of [['b1', 'c3'], ['g8', 'f6'], ['g1', 'f3']] as const) await playMove(page, a, b);
    await expect(line(page)).toHaveText('1. Nc3 Nf6 2. Nf3');
    await expect(chip).toContainText('1. Nf3 Nf6 2. Nc3');
    await chip.click();
    await expect(line(page)).toHaveText('1. Nf3 Nf6 2. Nc3');
  });

  test('the top bar names the opening, with a +n suffix when out of book', async ({ page }) => {
    const name = page.getByTestId('opening-name');
    await edit(page);
    await page.getByTestId('pin-toggle').click();
    await expect(page.getByTestId('opening')).toBeHidden();
    await playMove(page, 'e2', 'e4');
    await expect(name).toHaveText("King's Pawn Game");
    await playMove(page, 'e7', 'e5');
    await playMove(page, 'g1', 'f3');
    await expect(name).toHaveText("King's Knight Opening");
    await playMove(page, 'b8', 'c6');
    await playMove(page, 'f1', 'b5');
    await expect(name).toHaveText('Ruy Lopez');
    await playMove(page, 'h7', 'h6');
    await playMove(page, 'h2', 'h3');
    await expect(name).toHaveText(/^Ruy Lopez.* \+\d+$/);
  });
});

test.describe('leaving the board', () => {
  test('clicking or dragging the bare map closes the board; pins and markers do not', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await enterPin(page);
    const card = page.getByTestId('board');
    await expect(card).toBeVisible();
    await page.mouse.click(60, 300);
    await expect(card).toBeHidden();
    await expect(page.getByTestId('back-to-board')).toBeHidden(); // nothing to go back to
    await page.keyboard.press('ArrowLeft'); // navigating reopens it
    await expect(card).toBeVisible();
    await panMap(page);
    await expect(card).toBeHidden();
  });
});

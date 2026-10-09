import { expect, test } from '@playwright/test';
import {
  back, edit, enterPin, expectStartFen, explore, forward, line, mockNetwork, nodeAt, nodeCount, panMap, play, settled, snapshot,
  spawn, squareAt, twoLevels, type Snapshot,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await mockNetwork(page);
  await page.goto('./');
  await expect(page.getByTestId('board')).toBeVisible();
});

test('an empty repertoire starts in Edit with the start position and a geocoded place', async ({ page }) => {
  await expect(page.getByTestId('mode-edit')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-testid="board"] cg-board')).toBeVisible();
  await expectStartFen(page);
  await expect(line(page)).toHaveText('');
  await expect(page.getByTestId('place-label')).toHaveText('Testville, Testland');
});

test('edit: a move spawns a pin; clicking enters it, back and forward navigate', async ({ page }) => {
  await edit(page);
  await expect(page.getByTestId('mode-toggle')).toHaveAttribute('data-mode', 'edit');
  await spawn(page, 'e2', 'e4');
  const pin = page.getByTestId('pin');
  await expect(pin).toHaveCount(1);
  await expect(pin).toHaveAttribute('data-label', '1.e4');
  await expectStartFen(page); // the board did not advance

  await enterPin(page);
  await expect(line(page)).toHaveText('1. e4');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', / b KQkq /);

  await back(page);
  await expect(line(page)).toHaveText('');
  await forward(page);
  await expect(line(page)).toHaveText('1. e4');

  await page.keyboard.press('ArrowLeft');
  await expect(line(page)).toHaveText('');
  await page.keyboard.press('ArrowRight');
  await expect(line(page)).toHaveText('1. e4');
});

test('note editor: clicking inside moves the caret, Enter closes, Shift+Enter adds a line', async ({ page }) => {
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

test('a note edited from the board header persists and shows under the board', async ({ page }) => {
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

test('centered mode: zoom stays on the board; panning leaves it, Back to board and board switches restore it', async ({ page }) => {
  const backToBoard = page.getByTestId('back-to-board');
  await expect(backToBoard).toBeHidden();
  await settled(page);
  const c0 = (await snapshot(page)).center;
  await page.mouse.move(60, 300);
  await page.mouse.wheel(0, -300); // zoom in with the pointer far from the board
  await page.waitForTimeout(500);
  const c1 = (await snapshot(page)).center;
  expect(c1[0]).toBeCloseTo(c0[0], 5);
  expect(c1[1]).toBeCloseTo(c0[1], 5);
  await panMap(page);
  await expect(backToBoard).toBeVisible();
  await backToBoard.click();
  await expect(backToBoard).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).center[0]).toBeCloseTo(c0[0], 3);
  await panMap(page);
  await expect(backToBoard).toBeVisible();
  await edit(page);
  await spawn(page, 'e2', 'e4');
  await enterPin(page); // switching boards restores it
  await expect(backToBoard).toBeHidden();
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

test('back-to-back moves with no waits are not dropped', async ({ page }) => {
  await edit(page);
  await page.getByTestId('pin-toggle').click();
  await play(page, 'e2', 'e4'); // creates the pinned node and recenters; the following plies are appended in place
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

test('carry-to-place: the pin lands where you click; Escape cancels', async ({ page }) => {
  const card = page.getByTestId('board-card');
  await edit(page);
  await play(page, 'd2', 'd4');
  await expect(card).toHaveClass(/placing/);
  await page.keyboard.press('Escape');
  await expect(card).not.toHaveClass(/placing/);
  await expect(page.getByTestId('pin')).toHaveCount(0);
  await expectStartFen(page);

  await play(page, 'd2', 'd4');
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

test('pin mode records a segment, replays it and undoes the last ply', async ({ page }) => {
  await edit(page);
  await page.getByTestId('pin-toggle').click();
  for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']] as const) await play(page, a, b);
  await expect(line(page)).toHaveText('1. e4 e5 2. Nf3');

  await back(page, 3);
  await expect(line(page)).toHaveText('');
  await forward(page, 3);
  await expect(line(page)).toHaveText('1. e4 e5 2. Nf3');

  await expect(page.getByTestId('undo-ply')).toBeEnabled();
  await page.getByTestId('undo-ply').click();
  await expect(line(page)).toHaveText('1. e4 e5');
});

test('explore: a move outside the repertoire snaps back with a toast', async ({ page }) => {
  await explore(page);
  await play(page, 'd2', 'd4');
  await expect(page.getByTestId('toast')).toHaveText('Not in repertoire');
  await expectStartFen(page);
  await expect(line(page)).toHaveText('');
});

test('deleting a position asks first (trash or Delete key) and removes its subtree', async ({ page }) => {
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

test('the board header opens the current line in Lichess', async ({ page }) => {
  await edit(page);
  const popup = page.waitForEvent('popup');
  await page.getByTestId('board-lichess').click();
  expect((await popup).url()).toContain('lichess.org');
});

test('overview shows the whole tree faded', async ({ page }) => {
  await twoLevels(page);
  const faded = page.getByTestId('pin-overview');
  await expect(faded).toHaveCount(1); // on by default
  await page.getByTestId('overview-toggle').click();
  await expect(faded).toHaveCount(0);
  await page.getByTestId('overview-toggle').click();
  await expect(faded).toHaveCount(1);
});

test('transposition chip links to the other route', async ({ page }) => {
  const chip = page.getByTestId('transposition');
  await edit(page);
  await page.getByTestId('pin-toggle').click();
  for (const [a, b] of [['g1', 'f3'], ['g8', 'f6'], ['b1', 'c3']] as const) await play(page, a, b);
  await expect(line(page)).toHaveText('1. Nf3 Nf6 2. Nc3');
  await expect(chip).toBeHidden();
  await back(page, 3);
  for (const [a, b] of [['b1', 'c3'], ['g8', 'f6'], ['g1', 'f3']] as const) await play(page, a, b);
  await expect(line(page)).toHaveText('1. Nc3 Nf6 2. Nf3');
  await expect(chip).toContainText('1. Nf3 Nf6 2. Nc3');
  await chip.click();
  await expect(line(page)).toHaveText('1. Nf3 Nf6 2. Nc3');
});

test('export and import JSON round-trip', async ({ page }) => {
  await edit(page);
  await spawn(page, 'e2', 'e4');
  await page.getByTestId('menu-button').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('menu-export-json').click()]);
  expect(download.suggestedFilename()).toContain('.chessmap.json');

  await page.getByTestId('import-json-input').setInputFiles((await download.path())!);
  await expect(page.getByTestId('map-select').locator('option')).toHaveCount(2);
  await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.e4');
});

test('export and import PGN round-trip', async ({ page }) => {
  await twoLevels(page);
  const before = await snapshot(page);
  await page.getByTestId('menu-button').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('menu-export-pgn').click()]);
  expect(download.suggestedFilename()).toMatch(/\.pgn$/);

  await page.getByTestId('import-pgn-input').setInputFiles((await download.path())!);
  await expect(page.getByTestId('map-select').locator('option')).toHaveCount(2);
  const after = await snapshot(page);
  expect(after.id).not.toBe(before.id);
  expect(Object.keys(after.nodes)).toHaveLength(Object.keys(before.nodes).length);
  await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.e4');
});

test('set location: place label opens the sheet, Enter moves the board and sets the place', async ({ page }) => {
  await explore(page);
  await expect(page.getByTestId('place-label')).toBeDisabled(); // Explore: no relocation
  await edit(page);
  const before = nodeAt(await snapshot(page)).lngLat;
  await page.getByTestId('place-label').click();
  await expect(page.getByTestId('locate-title')).toHaveText('Move the start board to…');
  await expect(page.getByTestId('board-card')).toHaveClass(/relocating/);
  await page.getByTestId('locate-input').fill('Lisbon');
  await expect(page.getByTestId('locate-result').first()).toContainText('Lisbon');
  await expect(page.getByTestId('locate-ghost')).toBeVisible(); // preview of the first result
  expect(nodeAt(await snapshot(page)).lngLat).toEqual(before); // nothing committed yet
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('locate')).toBeHidden();
  await expect.poll(async () => nodeAt(await snapshot(page)).lngLat[0]).toBeCloseTo(-9.14, 2);
  await expect(page.getByTestId('place-label')).toHaveText('Lisbon, Portugal');
  await page.waitForTimeout(500); // checks an absence: the reverse geocoder (Testville) must not overwrite it
  await expect(page.getByTestId('place-label')).toHaveText('Lisbon, Portugal');
});

test('set location: Escape cancels and leaves everything unchanged', async ({ page }) => {
  await edit(page);
  const before = nodeAt(await snapshot(page));
  await page.getByTestId('board-locate').click();
  await page.getByTestId('locate-input').fill('Lisbon');
  await expect(page.getByTestId('locate-result').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('locate')).toBeHidden();
  await expect(page.getByTestId('locate-ghost')).toHaveCount(0);
  expect(nodeAt(await snapshot(page))).toEqual(before);
});

test('set location: a pin can be moved with its branch from the board header', async ({ page }) => {
  await twoLevels(page);
  const s0 = await snapshot(page);
  await enterPin(page);
  await page.getByTestId('board-locate').click();
  await expect(page.getByTestId('locate-title')).toHaveText('Move 1.e4 to…');
  await page.getByTestId('locate-input').fill('Lisbon');
  await page.getByTestId('locate-result').first().hover();
  await page.getByTestId('locate-subtree').check();
  await page.getByTestId('locate-result').first().click(); // mouse click confirms
  await expect(page.getByTestId('locate')).toBeHidden();
  const s1 = await snapshot(page);
  expect(nodeAt(s1, 0).lngLat[0]).toBeCloseTo(-9.14, 2);
  expect(nodeAt(s1, 0).place?.label).toBe('Lisbon, Portugal');
  expect(nodeAt(s1).lngLat).toEqual(nodeAt(s0).lngLat);
  expect(nodeAt(s1, 0, 0).lngLat[0]).not.toBeCloseTo(nodeAt(s0, 0, 0).lngLat[0], 1); // the subtree travelled too
});

test('go to place is available in the menu without changing anything', async ({ page }) => {
  const before = nodeAt(await snapshot(page));
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-goto').click();
  await expect(page.getByTestId('locate-title')).toHaveText('Go to place');
  await page.getByTestId('locate-input').fill('Lisbon');
  await expect(page.getByTestId('locate-result').first()).toBeVisible();
  await page.getByTestId('locate-confirm').click();
  await expect(page.getByTestId('locate')).toBeHidden();
  expect(nodeAt(await snapshot(page))).toEqual(before);
});

test('explore: the board handle shows no drag hint or edit buttons', async ({ page }) => {
  await explore(page);
  await expect(page.getByTestId('board-locate')).toBeHidden();
  await expect(page.locator('.board-handle .grip')).toBeHidden();
  await edit(page);
  await expect(page.getByTestId('board-locate')).toBeVisible();
  await expect(page.getByTestId('pin-toggle')).toBeVisible();
  await explore(page);
  await expect(page.getByTestId('pin-toggle')).toBeHidden();
});

test('resize grip never hits a wall: past the max the camera zooms out instead', async ({ page }) => {
  const rootSize = (s: Snapshot) => nodeAt(s).sizeDelta ?? 0;
  await edit(page);
  await settled(page);
  const z0 = (await snapshot(page)).zoom;
  const g = (await page.getByTestId('board-grip').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 500, g.y + g.height / 2 + 500, { steps: 12 });
  const live = (await page.getByTestId('board').boundingBox())!;
  expect(live.width).toBeLessThanOrEqual(0.9 * 720 + 1); // pinned at the clamp
  expect((await snapshot(page)).zoom).toBeLessThan(z0 - 0.5); // camera compensates
  await page.mouse.up();
  const delta = rootSize(await snapshot(page));
  expect(delta).toBeGreaterThan(1);
  expect(delta * 4).toBeCloseTo(Math.round(delta * 4), 5); // snapped to 0.25
});

test.describe('touch', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test('carry-to-place: tap the map to move the ghost, then press Place', async ({ page }) => {
    await edit(page);
    const box = await settled(page);
    for (const sq of ['e2', 'e4']) await page.touchscreen.tap(squareAt(box, sq).x, squareAt(box, sq).y);
    await expect(page.getByTestId('place-confirm')).toBeVisible();
    await page.touchscreen.tap(60, 200);
    await page.getByTestId('place-confirm').click();
    await expect(page.getByTestId('place-confirm')).toBeHidden();
    const pin = page.getByTestId('pin');
    await expect(pin).toHaveCount(1);
    const pb = (await pin.boundingBox())!;
    expect(Math.abs(pb.x + pb.width / 2 - 60)).toBeLessThan(30);
  });
});

test('the top bar names the opening, with a +n suffix when out of book', async ({ page }) => {
  const name = page.getByTestId('opening-name');
  await edit(page);
  await page.getByTestId('pin-toggle').click();
  await expect(page.getByTestId('opening')).toBeHidden();
  await play(page, 'e2', 'e4');
  await expect(name).toHaveText("King's Pawn Game");
  await play(page, 'e7', 'e5');
  await play(page, 'g1', 'f3');
  await expect(name).toHaveText("King's Knight Opening");
  await play(page, 'b8', 'c6');
  await play(page, 'f1', 'b5');
  await expect(name).toHaveText('Ruy Lopez');
  await play(page, 'h7', 'h6');
  await play(page, 'h2', 'h3');
  await expect(name).toHaveText(/^Ruy Lopez.* \+\d+$/);
});

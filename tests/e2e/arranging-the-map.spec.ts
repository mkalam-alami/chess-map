import { expect, test } from './fixtures';
import { edit, enterPin, explore, nodeAt, openApp, settled, snapshot, twoLevels, type Snapshot } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Drags the header of the visible board by (dx, dy) pixels, with the given key held (e.g. Shift moves the whole branch). */
async function dragBoard(page: import('@playwright/test').Page, dx: number, dy: number, key?: 'Shift'): Promise<void> {
  const grip = (await page.locator('.board-handle').boundingBox())!;
  const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  if (key) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  if (key) await page.keyboard.up(key);
}

test.describe('moving boards and pins', () => {
  test('dragging a board by its handle moves that position only', async ({ page }) => {
    await twoLevels(page);
    await enterPin(page); // at 1.e4, which has a child
    await settled(page);
    const before = await snapshot(page);
    await dragBoard(page, -140, 60);
    const after = await snapshot(page);
    expect(nodeAt(after, 0).lngLat[0]).toBeLessThan(nodeAt(before, 0).lngLat[0]);
    expect(nodeAt(after, 0).lngLat[1]).toBeLessThan(nodeAt(before, 0).lngLat[1]); // south: the screen y grew
    expect(nodeAt(after, 0, 0).lngLat).toEqual(nodeAt(before, 0, 0).lngLat); // its child stayed
    expect(nodeAt(after).lngLat).toEqual(nodeAt(before).lngLat);
  });

  test('Shift-dragging a board moves its whole branch', async ({ page }) => {
    await twoLevels(page);
    await enterPin(page);
    await settled(page);
    const before = await snapshot(page);
    await dragBoard(page, -140, 60, 'Shift');
    const after = await snapshot(page);
    const moved = (path: number[]): number => nodeAt(after, ...path).lngLat[0] - nodeAt(before, ...path).lngLat[0];
    expect(moved([0])).toBeLessThan(0);
    expect(moved([0, 0])).toBeCloseTo(moved([0]), 5); // the child travelled by the same amount
  });

  test('in Explore the board cannot be dragged', async ({ page }) => {
    await twoLevels(page);
    await enterPin(page);
    await explore(page);
    await settled(page);
    const before = await snapshot(page);
    await dragBoard(page, -140, 60);
    expect(nodeAt(await snapshot(page), 0).lngLat).toEqual(nodeAt(before, 0).lngLat);
  });
});

test.describe('board size', () => {
  test('the resize grip never hits a wall: past the max the camera zooms out instead', async ({ page }) => {
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
});

test.describe('set location by city', () => {
  test('the place label opens the sheet, Enter moves the board and sets the place', async ({ page }) => {
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

  test('the L key opens the same sheet', async ({ page }) => {
    await edit(page);
    await page.keyboard.press('l');
    await expect(page.getByTestId('locate-title')).toHaveText('Move the start board to…');
  });

  test('Escape cancels and leaves everything unchanged', async ({ page }) => {
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

  test('a pin can be moved with its branch from the board header', async ({ page }) => {
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
});

test.describe('go to place', () => {
  test('is available in the menu without changing anything', async ({ page }) => {
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

  test('flies the map to the place (also in Explore)', async ({ page }) => {
    await explore(page);
    await page.getByTestId('menu-button').click();
    await page.getByTestId('menu-goto').click();
    await page.getByTestId('locate-input').fill('Lisbon');
    await expect(page.getByTestId('locate-result').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('locate')).toBeHidden();
    await expect.poll(async () => (await snapshot(page)).center[0], { timeout: 10_000 }).toBeCloseTo(-9.14, 0);
  });
});

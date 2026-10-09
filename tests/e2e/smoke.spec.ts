import { expect, test, type Page } from '@playwright/test';

// Network is mocked: no real tiles, Nominatim or Photon requests are made.

const STYLE = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#9bbbe8' } }] };

async function mockNetwork(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.request().url().includes('/styles/')
      ? route.fulfill({ json: STYLE })
      : route.fulfill({ status: 204, body: '' }),
  );
  await page.route('https://nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ json: { address: { city: 'Testville', country: 'Testland' } } }),
  );
  await page.route('https://photon.komoot.io/**', (route) =>
    route.fulfill({
      json: {
        features: [
          {
            geometry: { coordinates: [-9.14, 38.72] },
            properties: { name: 'Lisbon', country: 'Portugal', extent: [-9.23, 38.80, -9.09, 38.69] },
          },
        ],
      },
    }),
  );
}

/** The map eases to the focused node; wait until the board stopped sliding. */
async function settled(page: Page) {
  const board = page.locator('[data-testid="board"] cg-board');
  let prev = '';
  for (let i = 0; i < 40; i++) {
    const b = await board.boundingBox();
    const cur = JSON.stringify(b);
    if (b && cur === prev) return b;
    prev = cur;
    await page.waitForTimeout(120);
  }
  throw new Error('board never settled');
}

const squareAt = (box: { x: number; y: number; width: number }, sq: string) => {
  const s = box.width / 8;
  return { x: box.x + (sq.charCodeAt(0) - 97 + 0.5) * s, y: box.y + (8 - Number(sq[1]) + 0.5) * s }; // white at the bottom
};

async function play(page: Page, from: string, to: string): Promise<void> {
  const box = await settled(page);
  if (!box) throw new Error('board not visible');
  await page.mouse.click(squareAt(box, from).x, squareAt(box, from).y);
  await page.mouse.click(squareAt(box, to).x, squareAt(box, to).y);
}

/** Edit mode: plays a move, then drops the carried ghost pin to the right of the board. */
async function spawn(page: Page, from: string, to: string, slot = 0): Promise<void> {
  await play(page, from, to);
  await expect(page.getByTestId('board-card')).toHaveClass(/placing/);
  const box = await settled(page);
  if (!box) throw new Error('board not visible');
  const at = { x: box.x + box.width + 120, y: box.y + 40 + slot * 70 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('board-card')).not.toHaveClass(/placing/);
}

test.beforeEach(async ({ page }) => {
  await mockNetwork(page);
  await page.goto('./');
  await expect(page.getByTestId('board')).toBeVisible();
});

const edit = (page: Page) => page.getByTestId('mode-edit').click();
const line = (page: Page) => page.getByTestId('line');
const nodeCount = (page: Page) =>
  page.evaluate(() => Object.keys((window as unknown as { __chessMap: { activeMap(): { nodes: object } } }).__chessMap.activeMap().nodes).length);

const activeId = (page: Page) =>
  page.evaluate(() => (window as unknown as { __chessMap: { activeMap(): { id: string } } }).__chessMap.activeMap().id);

/** e4 spawned, entered, e5 spawned, back at the start (3 nodes). */
async function twoLevels(page: Page): Promise<void> {
  await edit(page);
  await spawn(page, 'e2', 'e4');
  await page.getByTestId('pin').getByTestId('pin-enter').click();
  await spawn(page, 'e7', 'e5');
  await expect(page.getByTestId('pin')).toHaveCount(1);
  await page.getByTestId('btn-back').click();
  await expect(line(page)).toHaveText('');
}

test('initial board is visible with an empty line and a geocoded place', async ({ page }) => {
  await expect(page.locator('[data-testid="board"] cg-board')).toBeVisible();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp/);
  await expect(line(page)).toHaveText('');
  await expect(page.getByTestId('place-label')).toHaveText('Testville, Testland');
});

test('edit: a move spawns a pin; enter, back and forward navigate', async ({ page }) => {
  await edit(page);
  await expect(page.getByTestId('mode-toggle')).toHaveAttribute('data-mode', 'edit');
  await expect(page.getByTestId('mode-edit')).toHaveAttribute('aria-checked', 'true');
  await spawn(page, 'e2', 'e4');
  const pin = page.getByTestId('pin');
  await expect(pin).toHaveCount(1);
  await expect(pin).toHaveAttribute('data-label', '1.e4');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP/); // board did not advance

  await pin.getByTestId('pin-enter').click();
  await expect(line(page)).toHaveText('1. e4');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', / b KQkq /);

  await page.getByTestId('btn-back').click();
  await expect(line(page)).toHaveText('');
  await page.getByTestId('btn-forward').click();
  await expect(line(page)).toHaveText('1. e4');

  await page.keyboard.press('ArrowLeft');
  await expect(line(page)).toHaveText('');
  await page.keyboard.press('ArrowRight');
  await expect(line(page)).toHaveText('1. e4');
});

test('double-click enters a pin and leaves no popover behind', async ({ page }) => {
  await edit(page);
  await spawn(page, 'e2', 'e4');
  await page.getByTestId('pin').locator('.pin-label').dblclick();
  await expect(line(page)).toHaveText('1. e4');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('popover')).toHaveCount(0);
});

test('back-to-back moves with no waits are not dropped', async ({ page }) => {
  await edit(page);
  await page.getByTestId('pin-toggle').click();
  await play(page, 'e2', 'e4'); // creates the pinned node and recenters; the following plies are appended in place
  const box = (await settled(page))!;
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
  await edit(page);
  await play(page, 'd2', 'd4');
  await expect(page.getByTestId('board-card')).toHaveClass(/placing/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-card')).not.toHaveClass(/placing/);
  await expect(page.getByTestId('pin')).toHaveCount(0);
  await expect(page.getByTestId("board")).toHaveAttribute("data-fen", /^rnbqkbnr[/]pppppppp[/]8[/]8[/]8[/]8[/]PPPPPPPP/);

  await play(page, 'd2', 'd4');
  const box = (await settled(page))!;
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
  await play(page, 'e2', 'e4');
  await play(page, 'e7', 'e5');
  await play(page, 'g1', 'f3');
  await expect(line(page)).toHaveText('1. e4 e5 2. Nf3');

  for (let i = 0; i < 3; i++) await page.getByTestId('btn-back').click();
  await expect(line(page)).toHaveText('');
  for (let i = 0; i < 3; i++) await page.getByTestId('btn-forward').click();
  await expect(line(page)).toHaveText('1. e4 e5 2. Nf3');

  await expect(page.getByTestId('undo-ply')).toBeEnabled();
  await page.getByTestId('undo-ply').click();
  await expect(line(page)).toHaveText('1. e4 e5');
});

test('explore: a move outside the repertoire snaps back with a toast', async ({ page }) => {
  await play(page, 'd2', 'd4');
  await expect(page.getByTestId('toast')).toHaveText('Not in repertoire');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP/);
  await expect(line(page)).toHaveText('');
});

test('a note saved in the popover persists', async ({ page }) => {
  await edit(page);
  await spawn(page, 'e2', 'e4');
  await page.getByTestId('pin').locator('.pin-label').click();
  await page.getByTestId('pop-note').fill('King pawn, Lisbon trip');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pin').locator('.pin-note')).toBeVisible();
  await page.waitForTimeout(700); // autosave debounce
  await page.reload();
  await expect(page.getByTestId('pin').locator('.pin-note')).toBeVisible();
});

test('deleting a pin removes its subtree after confirmation', async ({ page }) => {
  await twoLevels(page);
  expect(await nodeCount(page)).toBe(3);
  await page.getByTestId('pin').locator('.pin-label').click();
  await page.getByTestId('pop-delete').click();
  await expect(page.getByTestId('dialog')).toContainText('1 below');
  await page.getByTestId('dialog-ok').click();
  await expect(page.getByTestId('pin')).toHaveCount(0);
  expect(await nodeCount(page)).toBe(1);
});

test('overview shows the whole tree faded', async ({ page }) => {
  await twoLevels(page);
  await expect(page.getByTestId('pin-overview')).toHaveCount(0);
  await page.getByTestId('overview-toggle').click();
  await expect(page.getByTestId('pin-overview')).toHaveCount(1);
  await page.getByTestId('overview-toggle').click();
  await expect(page.getByTestId('pin-overview')).toHaveCount(0);
});

test('transposition chip links to the other route', async ({ page }) => {
  await edit(page);
  await page.getByTestId('pin-toggle').click();
  for (const [a, b] of [['g1', 'f3'], ['g8', 'f6'], ['b1', 'c3']] as const) await play(page, a, b);
  await expect(line(page)).toHaveText('1. Nf3 Nf6 2. Nc3');
  await expect(page.getByTestId('transposition')).toHaveCount(1);
  await expect(page.getByTestId('transposition')).toBeHidden();
  for (let i = 0; i < 3; i++) await page.getByTestId('btn-back').click();
  for (const [a, b] of [['b1', 'c3'], ['g8', 'f6'], ['g1', 'f3']] as const) await play(page, a, b);
  await expect(line(page)).toHaveText('1. Nc3 Nf6 2. Nf3');
  await expect(page.getByTestId('transposition')).toContainText('1. Nf3 Nf6 2. Nc3');
  await page.getByTestId('transposition').click();
  await expect(line(page)).toHaveText('1. Nf3 Nf6 2. Nc3');
});

test('export and import JSON round-trip', async ({ page }) => {
  await edit(page);
  await spawn(page, 'e2', 'e4');
  await expect(page.getByTestId('pin')).toHaveCount(1);

  await page.getByTestId('menu-button').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('menu-export-json').click()]);
  const path = await download.path();
  expect(download.suggestedFilename()).toContain('.chessmap.json');

  await page.getByTestId('import-json-input').setInputFiles(path!);
  await expect(page.getByTestId('map-select').locator('option')).toHaveCount(2);
  await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.e4');
});

test('export and import PGN round-trip', async ({ page }) => {
  await twoLevels(page);
  const before = await nodeCount(page);
  const oldId = await activeId(page);

  await page.getByTestId('menu-button').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('menu-export-pgn').click()]);
  expect(download.suggestedFilename()).toMatch(/\.pgn$/);
  const path = await download.path();

  await page.getByTestId('import-pgn-input').setInputFiles(path!);
  await expect(page.getByTestId('map-select').locator('option')).toHaveCount(2);
  expect(await activeId(page)).not.toBe(oldId);
  expect(await nodeCount(page)).toBe(before);
  await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.e4');
});

const nodeAt = (page: Page, which: 'root' | 'first-child') =>
  page.evaluate((w) => {
    const m = (window as unknown as { __chessMap: { activeMap(): { rootId: string; nodes: Record<string, { lngLat: number[]; children: string[]; place?: { label: string } }> } } }).__chessMap.activeMap();
    const root = m.nodes[m.rootId]!;
    return w === 'root' ? root : m.nodes[root.children[0]!]!;
  }, which);

test('set location: place label opens the sheet, Enter moves the board and sets the place', async ({ page }) => {
  await expect(page.getByTestId('place-label')).toBeDisabled(); // Explore: no relocation
  await edit(page);
  const before = (await nodeAt(page, 'root')).lngLat;
  await page.getByTestId('place-label').click();
  await expect(page.getByTestId('locate-title')).toHaveText('Move the start board to…');
  await expect(page.getByTestId('board-card')).toHaveClass(/relocating/);
  await page.getByTestId('locate-input').fill('Lisbon');
  await expect(page.getByTestId('locate-result').first()).toContainText('Lisbon');
  await expect(page.getByTestId('locate-ghost')).toBeVisible(); // preview of the first result
  expect((await nodeAt(page, 'root')).lngLat).toEqual(before); // nothing committed yet
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('locate')).toBeHidden();
  await expect.poll(async () => (await nodeAt(page, 'root')).lngLat[0]).toBeCloseTo(-9.14, 2);
  await expect(page.getByTestId('place-label')).toHaveText('Lisbon, Portugal');
  await page.waitForTimeout(500); // the reverse geocoder (Testville) must not overwrite it
  await expect(page.getByTestId('place-label')).toHaveText('Lisbon, Portugal');
});

test('set location: Escape cancels and leaves everything unchanged', async ({ page }) => {
  await edit(page);
  const before = await nodeAt(page, 'root');
  await page.getByTestId('board-locate').click();
  await page.getByTestId('locate-input').fill('Lisbon');
  await expect(page.getByTestId('locate-result').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('locate')).toBeHidden();
  await expect(page.getByTestId('locate-ghost')).toHaveCount(0);
  expect(await nodeAt(page, 'root')).toEqual(before);
});

test('set location: a pin can be moved with its branch from its popover', async ({ page }) => {
  await twoLevels(page);
  const root0 = await nodeAt(page, 'root');
  const child0 = await nodeAt(page, 'first-child');
  await page.getByTestId('pin').locator('.pin-label').click();
  await page.getByTestId('pop-locate').click();
  await expect(page.getByTestId('locate-title')).toHaveText('Move 1.e4 to…');
  await page.getByTestId('locate-input').fill('Lisbon');
  await page.getByTestId('locate-result').first().hover();
  await page.getByTestId('locate-subtree').check();
  await page.getByTestId('locate-result').first().click(); // mouse click confirms
  await expect(page.getByTestId('locate')).toBeHidden();
  const child1 = await nodeAt(page, 'first-child');
  expect(child1.lngLat[0]).toBeCloseTo(-9.14, 2);
  expect(child1.place?.label).toBe('Lisbon, Portugal');
  expect((await nodeAt(page, 'root')).lngLat).toEqual(root0.lngLat);
  const grand = await page.evaluate(() => {
    const m = (window as unknown as { __chessMap: { activeMap(): { rootId: string; nodes: Record<string, { lngLat: number[]; children: string[] }> } } }).__chessMap.activeMap();
    return m.nodes[m.nodes[m.nodes[m.rootId]!.children[0]!]!.children[0]!]!.lngLat;
  });
  expect(grand[0]!).not.toBeCloseTo(child0.lngLat[0]!, 1); // the subtree travelled too
});

test('go to place is available in the menu without changing anything', async ({ page }) => {
  const before = await nodeAt(page, 'root');
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-goto').click();
  await expect(page.getByTestId('locate-title')).toHaveText('Go to place');
  await page.getByTestId('locate-input').fill('Lisbon');
  await expect(page.getByTestId('locate-result').first()).toBeVisible();
  await page.getByTestId('locate-confirm').click();
  await expect(page.getByTestId('locate')).toBeHidden();
  expect(await nodeAt(page, 'root')).toEqual(before);
});

test('explore: the board handle shows no drag hint or edit buttons', async ({ page }) => {
  await expect(page.getByTestId('board-locate')).toBeHidden();
  await expect(page.locator('.board-handle .grip')).toBeHidden();
  await edit(page);
  await expect(page.getByTestId('board-locate')).toBeVisible();
  await expect(page.getByTestId('pin-toggle')).toBeVisible();
  await page.getByTestId('mode-explore').click();
  await expect(page.getByTestId('pin-toggle')).toBeHidden();
});

test('board resize: + grows the board and re-focus zooms out accordingly', async ({ page }) => {
  const zoom = () => page.evaluate(() => (window as unknown as { __chessMap: { map: { getZoom(): number } } }).__chessMap.map.getZoom());
  const width = async () => (await page.getByTestId('board').boundingBox())!.width;
  await expect(page.getByTestId('board-grip')).toBeHidden(); // Explore: no grip
  await edit(page);
  await expect(page.getByTestId('board-grip')).toBeVisible();
  await spawn(page, 'e2', 'e4');
  await page.getByTestId('pin').getByTestId('pin-enter').click(); // focus -> comfortable size
  await settled(page);
  const w0 = await width();
  const z0 = await zoom();
  await page.getByTestId('board-bigger').click();
  await page.getByTestId('board-bigger').click();
  await expect.poll(width).toBeGreaterThan(w0 * 1.3); // immediately larger at the same zoom
  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-forward').click(); // re-focus the resized board
  await settled(page);
  await page.waitForTimeout(300);
  expect(await zoom()).toBeCloseTo(z0 - 0.5, 1); // bigger board -> lower zoom for the same on-screen size
  expect(Math.abs((await width()) - w0)).toBeLessThan(w0 * 0.1);
});

test('resize grip never hits a wall: past the max the camera zooms out instead', async ({ page }) => {
  const info = () =>
    page.evaluate(() => {
      const w = window as unknown as { __chessMap: { map: { getZoom(): number }; activeMap(): { rootId: string; nodes: Record<string, { sizeDelta?: number }> } } };
      const m = w.__chessMap.activeMap();
      return { zoom: w.__chessMap.map.getZoom(), delta: m.nodes[m.rootId]?.sizeDelta ?? 0 };
    });
  await edit(page);
  await settled(page);
  const z0 = (await info()).zoom;
  const g = (await page.getByTestId('board-grip').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 500, g.y + g.height / 2 + 500, { steps: 12 });
  const live = (await page.getByTestId('board').boundingBox())!;
  expect(live.width).toBeLessThanOrEqual(0.9 * 720 + 1); // pinned at the clamp
  expect((await info()).zoom).toBeLessThan(z0 - 0.5); // camera compensates
  await page.mouse.up();
  const end = await info();
  expect(end.delta).toBeGreaterThan(1);
  expect(end.delta * 4).toBeCloseTo(Math.round(end.delta * 4), 5); // snapped to 0.25
});

test.describe('touch', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test('carry-to-place: tap the map to move the ghost, then press Place', async ({ page }) => {
    await edit(page);
    const box = (await settled(page))!;
    const tap = async (sq: string) => {
      const p = squareAt(box, sq);
      await page.touchscreen.tap(p.x, p.y);
    };
    await tap('e2');
    await tap('e4');
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
  await edit(page);
  await page.getByTestId('pin-toggle').click();
  const name = page.getByTestId('opening-name');
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

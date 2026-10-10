import { expect, type Page } from '@playwright/test';
import type { ChessMapData as ChessMap, MapNodeData as MapNode } from '../../src/domain';

// Network mocks live in fixtures.ts (the `test` exported there installs them for every test).

/** Opens the app and waits until the board is on screen. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('board')).toBeVisible();
}

/** The `window.__chessMap` handle set in src/main.ts. */
interface ChessMapDebug {
  map: { getZoom(): number; getCenter(): { lng: number; lat: number } };
  activeMap(): ChessMap;
}

/** Serializable copy of the active map and the camera. */
export interface Snapshot { id: string; rootId: string; nodes: Record<string, MapNode>; zoom: number; center: [number, number] }

export const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const d = (window as unknown as { __chessMap: ChessMapDebug }).__chessMap;
    const m = d.activeMap();
    const c = d.map.getCenter();
    return { id: m.id, rootId: m.rootId, nodes: m.nodes, zoom: d.map.getZoom(), center: [c.lng, c.lat] };
  });

/** Root -> child -> ... following child indexes (`nodeAt(s)` is the root). */
export const nodeAt = (s: Snapshot, ...path: number[]): MapNode =>
  path.reduce((n, i) => s.nodes[n.children[i] as string] as MapNode, s.nodes[s.rootId] as MapNode);

export const nodeCount = async (page: Page): Promise<number> => Object.keys((await snapshot(page)).nodes).length;

/** The map eases to the focused node; wait until the board has not moved for three consecutive samples. */
export async function settled(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const board = page.locator('[data-testid="board"] cg-board');
  let prev = '';
  let still = 0;
  for (let i = 0; i < 60; i++) {
    const b = await board.boundingBox();
    const cur = JSON.stringify(b);
    still = b && cur === prev ? still + 1 : 0;
    if (b && still >= 2) return b;
    prev = cur;
    await page.waitForTimeout(100);
  }
  throw new Error('board never settled');
}

/** Centre of a square on the board box (white at the bottom). */
export const squareAt = (box: { x: number; y: number; width: number }, sq: string): { x: number; y: number } => {
  const s = box.width / 8;
  return { x: box.x + (sq.charCodeAt(0) - 97 + 0.5) * s, y: box.y + (8 - Number(sq[1]) + 0.5) * s };
};

/**
 * Plays a move on the board with two clicks (white at the bottom). The destination is clicked once the origin shows as
 * selected: clicking faster than the board reacts sometimes loses the move.
 */
export async function playMove(page: Page, from: string, to: string): Promise<void> {
  const box = await settled(page);
  const selected = page.locator('[data-testid="board"] square.selected');
  await expect(async () => {
    await page.mouse.click(squareAt(box, from).x, squareAt(box, from).y);
    await expect(selected).toHaveCount(1, { timeout: 500 });
  }).toPass({ timeout: 5000 });
  await page.mouse.click(squareAt(box, to).x, squareAt(box, to).y);
}

/** Edit mode: plays a move, then drops the carried ghost pin to the right of the board. */
export async function spawn(page: Page, from: string, to: string, slot = 0): Promise<void> {
  await playMove(page, from, to);
  await placeHere(page, slot);
}

/** While a move is carried as a ghost pin: drops it to the right of the board (`slot` stacks several one below the other). */
export async function placeHere(page: Page, slot = 0): Promise<void> {
  await expect(page.getByTestId('board-card')).toHaveClass(/placing/);
  const box = await settled(page);
  const at = { x: box.x + box.width + 120, y: box.y + 40 + slot * 70 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('board-card')).not.toHaveClass(/placing/);
}

/** Opens the ⋮ menu, then clicks one of its items (`export-json`, `new-map`, ...). */
export async function menu(page: Page, item: string): Promise<void> {
  await page.getByTestId('menu-button').click();
  await page.getByTestId(`menu-${item}`).click();
}

/** Names of the maps in the switcher, in order. */
export const mapNames = (page: Page): Promise<string[]> => page.getByTestId('map-select').locator('option').allTextContents();

/** Name of the active map. */
export const activeMapName = (page: Page): Promise<string> =>
  page.getByTestId('map-select').evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? '');

export const edit = (page: Page) => page.getByTestId('mode-edit').click();
export const explore = (page: Page) => page.getByTestId('mode-explore').click();
export const line = (page: Page) => page.getByTestId('line');

/** Clicks the (single) child pin, which enters it. */
export const enterPin = (page: Page) => page.getByTestId('pin').locator('.pin-label').click();

export async function back(page: Page, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) await page.getByTestId('btn-back').click();
}

export async function forward(page: Page, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) await page.getByTestId('btn-forward').click();
}

/** The board shows the start position (White's pieces unmoved). */
export const expectStartFen = (page: Page) =>
  expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\//);

/** e4 spawned, entered, e5 spawned, back at the start (3 nodes). */
export async function twoLevels(page: Page): Promise<void> {
  await edit(page);
  await spawn(page, 'e2', 'e4');
  await enterPin(page);
  await spawn(page, 'e7', 'e5');
  await expect(page.getByTestId('pin')).toHaveCount(1);
  await back(page);
  await expect(line(page)).toHaveText('');
}

/** Drags on empty map from (60, 300), which pans it. */
export async function panMap(page: Page): Promise<void> {
  await page.mouse.move(60, 300);
  await page.mouse.down();
  await page.mouse.move(160, 330, { steps: 6 });
  await page.mouse.up();
}

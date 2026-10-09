import { expect, type Page } from '@playwright/test';
import type { ChessMap, MapNode } from '../../src/model/types';

// Network is mocked: no real tiles, Nominatim or Photon requests are made.

const STYLE = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#9bbbe8' } }] };

export async function mockNetwork(page: Page): Promise<void> {
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

/** The map eases to the focused node; wait until the board stopped sliding. */
export async function settled(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
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

/** Centre of a square on the board box (white at the bottom). */
export const squareAt = (box: { x: number; y: number; width: number }, sq: string): { x: number; y: number } => {
  const s = box.width / 8;
  return { x: box.x + (sq.charCodeAt(0) - 97 + 0.5) * s, y: box.y + (8 - Number(sq[1]) + 0.5) * s };
};

export async function play(page: Page, from: string, to: string): Promise<void> {
  const box = await settled(page);
  for (const sq of [from, to]) await page.mouse.click(squareAt(box, sq).x, squareAt(box, sq).y);
}

/** Edit mode: plays a move, then drops the carried ghost pin to the right of the board. */
export async function spawn(page: Page, from: string, to: string, slot = 0): Promise<void> {
  await play(page, from, to);
  await expect(page.getByTestId('board-card')).toHaveClass(/placing/);
  const box = await settled(page);
  const at = { x: box.x + box.width + 120, y: box.y + 40 + slot * 70 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('board-card')).not.toHaveClass(/placing/);
}

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

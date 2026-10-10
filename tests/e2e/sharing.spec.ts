import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { edit, enterPin, line, mapNames, menu, openApp, snapshot, spawn, twoLevels } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

type Page = import('@playwright/test').Page;

const asFile = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const importJson = (page: Page, name: string, text: string) => page.getByTestId('import-json-input').setInputFiles(asFile(name, text));
const importPgn = (page: Page, name: string, text: string) => page.getByTestId('import-pgn-input').setInputFiles(asFile(name, text));

/** A map holding one pinned board with `plies` knight moves back and forth: a line too long for a Lichess URL. */
const longLineMap = (plies: number): string => {
  const cycle = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
  const root = { id: 'r', parentId: null, plies: [], pinned: false, lngLat: [2.35, 48.85], children: ['a'] };
  const line = { id: 'a', parentId: 'r', plies: Array.from({ length: plies }, (_, i) => cycle[i % 4]), pinned: true, lngLat: [2.6, 48.9], children: [] };
  const map = { id: 'long', name: 'Shuffle', orientation: 'white', rootId: 'r', nodes: { r: root, a: line } };
  return JSON.stringify({ format: 'chess-map', version: 1, map });
};

/** Plies of the shuffling game: enough for a Lichess URL over 2000 characters (about 240). */
const LONG = 260;

/** Presses → `plies` times (all in one go: hundreds of real key presses with a board animating are slow). */
async function walkTo(page: Page, plies: number): Promise<void> {
  await page.evaluate((n) => {
    for (let i = 0; i < n; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  }, plies);
  await expect(page.getByTestId('ply-count')).toHaveText(`Ply ${plies}`);
}

test.describe('JSON', () => {
  test('export and import round trip', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await page.getByTestId('menu-button').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('menu-export-json').click()]);
    expect(download.suggestedFilename()).toContain('.chessmap.json');

    await page.getByTestId('import-json-input').setInputFiles((await download.path())!);
    await expect(page.getByTestId('toast')).toHaveText('Map imported');
    await expect(page.getByTestId('map-select').locator('option')).toHaveCount(2);
    await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.e4');
  });

  test('the exported file is a readable chess-map file', async ({ page }) => {
    await edit(page);
    await spawn(page, 'e2', 'e4');
    await page.getByTestId('menu-button').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('menu-export-json').click()]);
    const file = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    expect(file.format).toBe('chess-map');
    expect(Object.values(file.map.nodes).flatMap((n) => (n as { plies: string[] }).plies)).toEqual(['e4']);
  });

  test('an invalid file explains what is wrong and changes nothing', async ({ page }) => {
    await importJson(page, 'broken.json', '{ not json');
    await expect(page.getByTestId('toast')).toContainText(/not valid JSON/i);
    await importJson(page, 'other.json', JSON.stringify({ hello: 'world' }));
    await expect(page.getByTestId('toast')).toContainText(/chess-map|version|format/i);
    expect(await mapNames(page)).toEqual(['My repertoire']);
  });

  test('a map with an illegal move is refused', async ({ page }) => {
    const bad = {
      format: 'chess-map', version: 1,
      map: {
        id: 'm', name: 'Bad', orientation: 'white', rootId: 'r',
        nodes: {
          r: { id: 'r', parentId: null, plies: [], pinned: false, lngLat: [0, 0], children: ['a'] },
          a: { id: 'a', parentId: 'r', plies: ['e5'], pinned: false, lngLat: [1, 1], children: [] },
        },
      },
    };
    await importJson(page, 'bad.json', JSON.stringify(bad));
    await expect(page.getByTestId('toast')).toContainText('illegal move');
    expect(await mapNames(page)).toEqual(['My repertoire']);
  });
});

test.describe('PGN', () => {
  test('export and import round trip', async ({ page }) => {
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

  test('a game from elsewhere (no positions) is laid out on the map', async ({ page }) => {
    await importPgn(page, 'my-game.pgn', '[Event "Casual"]\n\n1. e4 e5 2. Nf3 Nc6 *\n');
    await expect(page.getByTestId('toast')).toHaveText('Map imported');
    expect(await mapNames(page)).toHaveLength(2);
    await page.keyboard.press('ArrowRight'); // the imported moves are pins laid out around the board
    await expect(line(page)).toHaveText('1. e4');
  });

  test('a file with several games becomes several maps', async ({ page }) => {
    await importPgn(page, 'games.pgn', '[Event "One"]\n\n1. e4 e5 *\n\n[Event "Two"]\n\n1. d4 d5 *\n\n[Event "Three"]\n\n1. c4 *\n');
    await expect(page.getByTestId('toast')).toHaveText('Imported 3 maps');
    expect(await mapNames(page)).toHaveLength(4);
  });

  test('unreadable files explain what is wrong and change nothing', async ({ page }) => {
    await importPgn(page, 'empty.pgn', '   ');
    await expect(page.getByTestId('toast')).toHaveText('No PGN data found');
    await importPgn(page, 'cheat.pgn', '[Event "Illegal"]\n\n1. e4 e4 *\n');
    await expect(page.getByTestId('toast')).toContainText('illegal move "e4"');
    await importPgn(page, 'notes.pgn', 'this is not chess at all');
    await expect(page.getByTestId('toast')).toContainText(/PGN/);
    expect(await mapNames(page)).toEqual(['My repertoire']);
  });
});

test.describe('open in Lichess', () => {
  test('the menu opens the current line in the analysis board', async ({ page }) => {
    await twoLevels(page);
    await enterPin(page);
    const popup = page.waitForEvent('popup');
    await menu(page, 'open-lichess');
    expect((await popup).url()).toBe('https://lichess.org/analysis/pgn/1.%20e4');
  });

  test('the board header opens the current line in Lichess', async ({ page }) => {
    await edit(page);
    const popup = page.waitForEvent('popup');
    await page.getByTestId('board-lichess').click();
    expect((await popup).url()).toContain('lichess.org');
  });

  test('a map played as Black opens the analysis board from Black\'s side', async ({ page }) => {
    await menu(page, 'flip');
    const popup = page.waitForEvent('popup');
    await menu(page, 'open-lichess');
    expect((await popup).url()).toContain('?color=black');
  });

  test('a line too long for a URL copies the whole PGN and opens the study page', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await importJson(page, 'shuffle.json', longLineMap(LONG));
    await expect(page.getByTestId('toast')).toHaveText('Map imported');
    await walkTo(page, LONG);

    const popup = page.waitForEvent('popup');
    await menu(page, 'open-lichess');
    expect((await popup).url()).toBe('https://lichess.org/study');
    await expect(page.getByTestId('toast')).toHaveText('PGN copied — paste it into a new study chapter');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('[Event "Shuffle"]'); // the whole map as PGN, not just the line
    expect(clipboard).toMatch(/Nf3[^]*Nf6[^]*Ng1[^]*Ng8/);
  });

  test('when the clipboard refuses, the user is told and nothing opens', async ({ page, context }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
    });
    await page.reload();
    await expect(page.getByTestId('board')).toBeVisible();
    await importJson(page, 'shuffle.json', longLineMap(LONG));
    await expect(page.getByTestId('toast')).toHaveText('Map imported');
    await walkTo(page, LONG);
    await menu(page, 'open-lichess');
    await expect(page.getByTestId('toast')).toHaveText('Could not copy the PGN to the clipboard');
    expect(context.pages()).toHaveLength(1);
  });
});

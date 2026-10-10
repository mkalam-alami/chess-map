import { expect, test } from './fixtures';
import { edit, expectStartFen, line, mapNames, openApp, playMove, spawn } from './helpers';

type Page = import('@playwright/test').Page;

const STORAGE_KEY = 'chess-map:library';
const CORRUPT_KEY = 'chess-map:library:corrupt';

/** Puts `value` in localStorage before the app starts, on the first load only (a later reload keeps what the app saved). */
const seedLibrary = (page: Page, value: string) =>
  page.addInitScript(
    ([key, v]) => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(key as string, v as string);
      }
    },
    [STORAGE_KEY, value],
  );

const stored = (page: Page, key: string): Promise<string | null> => page.evaluate((k) => localStorage.getItem(k), key);

test.describe('when the geocoder is down', () => {
  test.describe('HTTP 500', () => {
    test.use({ geo: 'http-500' });

    test('the start place stays empty and the app remains usable', async ({ page }) => {
      await openApp(page);
      await expect(page.getByTestId('place-label')).toHaveText('');
      await edit(page);
      await spawn(page, 'e2', 'e4');
      await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.e4');
      await expect(page.getByTestId('place-label')).toHaveText('');
    });
  });

  test.describe('network failure', () => {
    test.use({ geo: 'offline' });

    test('moves can still be played, placed and navigated', async ({ page }) => {
      await openApp(page);
      await expect(page.getByTestId('place-label')).toHaveText('');
      await edit(page);
      await spawn(page, 'e2', 'e4');
      await page.getByTestId('pin').locator('.pin-label').click();
      await expect(line(page)).toHaveText('1. e4');
      await expect(page.getByTestId('toast')).not.toHaveClass(/show/); // failing silently: a missing place name is not worth a toast
    });
  });
});

test.describe('when place search is down', () => {
  for (const search of ['http-500', 'offline'] as const) {
    test.describe(search, () => {
      test.use({ search });

      test('the set-location panel shows no results and can still be cancelled or retried', async ({ page }) => {
        await openApp(page);
        await edit(page);
        await page.getByTestId('place-label').click();
        await page.getByTestId('locate-input').fill('Lisbon');
        await expect(page.getByTestId('locate-result')).toHaveCount(0);
        await expect(page.getByTestId('locate-status')).not.toHaveText(''); // says something instead of staying blank
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('locate')).toBeHidden();
        await expectStartFen(page);
        await playMove(page, 'e2', 'e4'); // the board still works
        await expect(page.getByTestId('board-card')).toHaveClass(/placing/);
      });
    });
  }
});

test.describe('stored library', () => {
  test('garbage is kept aside as "corrupt" and the app starts with a fresh repertoire', async ({ page }) => {
    await seedLibrary(page, '{ definitely not a library');
    await openApp(page);
    expect(await mapNames(page)).toEqual(['My repertoire']);
    await expect(page.getByTestId('mode-edit')).toHaveAttribute('aria-checked', 'true');
    expect(await stored(page, CORRUPT_KEY)).toBe('{ definitely not a library');
    // and the app saves normally afterwards
    await spawn(page, 'e2', 'e4');
    await expect.poll(() => stored(page, STORAGE_KEY)).toContain('"e4"');
    expect(await stored(page, CORRUPT_KEY)).toBe('{ definitely not a library');
  });

  test('valid JSON of the wrong shape is kept as "corrupt" too', async ({ page }) => {
    const wrong = JSON.stringify({ version: 2, maps: { x: { id: 'x' } }, activeMapId: 'x' });
    await seedLibrary(page, wrong);
    await openApp(page);
    expect(await mapNames(page)).toEqual(['My repertoire']);
    expect(await stored(page, CORRUPT_KEY)).toBe(wrong);
  });

  test('a library from a newer version is not understood, but not thrown away', async ({ page }) => {
    const future = JSON.stringify({ version: 999, maps: {}, activeMapId: 'x' });
    await seedLibrary(page, future);
    await openApp(page);
    expect(await mapNames(page)).toEqual(['My repertoire']);
    expect(await stored(page, CORRUPT_KEY)).toBe(future);
  });

  test('a hand-written library of the current version loads, notes and places included', async ({ page }) => {
    const library = {
      version: 2,
      activeMapId: 'm1',
      maps: {
        m1: {
          id: 'm1', name: 'Saved earlier', orientation: 'black', rootId: 'r',
          nodes: {
            r: { id: 'r', parentId: null, moves: [], pinned: false, lngLat: [2.35, 48.85], children: ['a'], place: { label: 'Paris, France' } },
            a: { id: 'a', parentId: 'r', moves: ['d4', 'd5'], pinned: true, lngLat: [2.6, 48.9], children: [], note: 'Queen pawn' },
          },
        },
      },
    };
    await seedLibrary(page, JSON.stringify(library));
    await page.goto('./'); // a loaded repertoire opens as pins only, so no board to wait for
    await expect(page.getByTestId('pin')).toBeVisible();
    expect(await mapNames(page)).toEqual(['Saved earlier']);
    await expect(page.getByTestId('place-label')).toHaveText('Paris, France');
    await expect(page.getByTestId('mode-explore')).toHaveAttribute('aria-checked', 'true'); // not empty: Explore
    await expect(page.getByTestId('pin')).toHaveAttribute('data-label', '1.d4 … (+1)');
    expect(await stored(page, CORRUPT_KEY)).toBeNull();
  });
});

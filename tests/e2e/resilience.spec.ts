import { expect, test } from './fixtures';

const STORAGE_KEY = 'chess-map:library';
const CORRUPT_KEY = 'chess-map:library:corrupt';

test.use({ geo: 'http-500' });

test('a corrupt stored library is kept aside and a failing geocoder does not stop the app', async ({ page, app }) => {
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key as string, value as string);
    }
  }, [STORAGE_KEY, '{ definitely not a library']);

  await app.open();
  expect(await app.topBar.mapNames()).toEqual(['My repertoire']);
  expect(await app.stored(CORRUPT_KEY)).toBe('{ definitely not a library');
  await expect(app.topBar.placeLabel).toHaveText('');

  await app.topBar.edit();
  await app.spawn('e2', 'e4');
  await expect(app.map.pin()).toHaveAttribute('data-label', '1.e4');
  await expect.poll(() => app.stored(STORAGE_KEY)).toContain('"e4"');
});

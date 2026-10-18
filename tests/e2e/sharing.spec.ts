import { expect, test } from './fixtures';

const asFile = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

test('export and import maps as JSON and PGN; invalid files change nothing', async ({ app }) => {
  const { topBar, map, menu } = app;
  await app.open();
  await app.buildTwoLevels();

  const json = await menu.download('export-json');
  expect(json.suggestedFilename()).toContain('.chessmap.json');
  await menu.importJson((await json.path())!);
  await expect(map.toast).toHaveText('Map imported');
  await expect.poll(() => topBar.mapNames()).toHaveLength(2);

  const pgn = await menu.download('export-pgn');
  expect(pgn.suggestedFilename()).toMatch(/\.pgn$/);
  await menu.importPgn((await pgn.path())!);
  await expect.poll(() => topBar.mapNames()).toHaveLength(3);
  await expect(map.pin()).toHaveAttribute('data-label', '1.e4');

  await menu.importJson(asFile('broken.json', '{ not json'));
  await expect(map.toast).toContainText(/not valid JSON/i);
  await menu.importPgn(asFile('empty.pgn', '   '));
  await expect(map.toast).toHaveText('No PGN data found');
  await expect.poll(() => topBar.mapNames()).toHaveLength(3);
});

test('open the current line in the Lichess analysis board', async ({ page, app }) => {
  await app.open();
  await app.buildTwoLevels();
  await app.map.enter();
  const popup = page.waitForEvent('popup');
  await app.menu.choose('open-lichess');
  expect((await popup).url()).toBe('https://lichess.org/analysis/pgn/1.%20e4');
});

import { expect, test } from './fixtures';
import { nodeAt } from './pages/ChessMapPage';

test('drag a board alone or with its branch, then move it to a city', async ({ page, app }) => {
  const { board, map, locate } = app;
  await app.open();
  await app.buildTwoLevels();
  await map.enter(); // at 1.e4, which has a child
  await board.settled();

  const s0 = await app.snapshot();
  await board.drag(-140, 60);
  const s1 = await app.snapshot();
  expect(nodeAt(s1, 0).lngLat[0]).toBeLessThan(nodeAt(s0, 0).lngLat[0]);
  expect(nodeAt(s1, 0, 0).lngLat).toEqual(nodeAt(s0, 0, 0).lngLat); // its child stayed

  await board.drag(-140, 60, 'Shift');
  const s2 = await app.snapshot();
  const moved = (path: number[]): number => nodeAt(s2, ...path).lngLat[0] - nodeAt(s1, ...path).lngLat[0];
  expect(moved([0])).toBeLessThan(0);
  expect(moved([0, 0])).toBeCloseTo(moved([0]), 5); // the child travelled by the same amount

  await board.locate.click();
  await expect(locate.title).toHaveText('Move 1.e4 to…');
  await locate.input.fill('Lisbon');
  await expect(locate.ghost).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(locate.root).toBeHidden();
  await expect.poll(async () => nodeAt(await app.snapshot(), 0).lngLat[0]).toBeCloseTo(-9.14, 2);
  expect(nodeAt(await app.snapshot(), 0).place?.label).toBe('Lisbon, Portugal');
});

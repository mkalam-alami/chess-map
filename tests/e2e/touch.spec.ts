import { expect, test } from './fixtures';
import { edit, openApp, settled, squareAt } from './helpers';

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

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

test('carry-to-place: Cancel drops the move without a pin', async ({ page }) => {
  await edit(page);
  const box = await settled(page);
  for (const sq of ['e2', 'e4']) await page.touchscreen.tap(squareAt(box, sq).x, squareAt(box, sq).y);
  await expect(page.getByTestId('place-confirm')).toBeVisible();
  await page.getByTestId('place-cancel').click();
  await expect(page.getByTestId('place-confirm')).toBeHidden();
  await expect(page.getByTestId('pin')).toHaveCount(0);
});

test('tapping a placed pin enters it', async ({ page }) => {
  await edit(page);
  const box = await settled(page);
  for (const sq of ['e2', 'e4']) await page.touchscreen.tap(squareAt(box, sq).x, squareAt(box, sq).y);
  await page.touchscreen.tap(60, 200);
  await page.getByTestId('place-confirm').click();
  await expect(page.getByTestId('pin')).toHaveCount(1);
  await settled(page);
  const pb = (await page.getByTestId('pin').boundingBox())!;
  await page.touchscreen.tap(pb.x + 6, pb.y + pb.height / 2 - 4); // the part of the pin that is not under the board
  await expect(page.getByTestId('ply-count')).toHaveText('Ply 1');
});

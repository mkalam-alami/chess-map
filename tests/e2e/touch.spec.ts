import { expect, test } from './fixtures';

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test('carry-to-place by touch: Cancel drops the move, Place drops the pin, tapping the pin enters it', async ({ page, app }) => {
  const { topBar, board, map } = app;
  await app.open();
  await topBar.edit();

  await board.tapMove('e2', 'e4');
  await expect(map.placeConfirm).toBeVisible();
  await map.placeCancel.click();
  await expect(map.placeConfirm).toBeHidden();
  await expect(map.pins).toHaveCount(0);

  await board.tapMove('e2', 'e4');
  await expect(map.placeConfirm).toBeVisible();
  await page.touchscreen.tap(60, 200);
  await map.placeConfirm.click();
  await expect(map.placeConfirm).toBeHidden();
  await expect(map.pins).toHaveCount(1);
  await board.settled();
  const pb = (await map.pin().boundingBox())!;
  expect(Math.abs(pb.x + pb.width / 2 - 60)).toBeLessThan(30);
  await page.touchscreen.tap(pb.x + 6, pb.y + pb.height / 2 - 4); // the part of the pin that is not under the board
  await expect(topBar.line).toHaveText('1. e4');
});

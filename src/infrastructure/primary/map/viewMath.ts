import { NOMINAL_PX } from '../../../domain';

// Pure presentation math for the map view (board pixel size, focus zoom, resize grip). Not domain logic.

export interface Viewport { width: number; height: number }

/** Rendered board width: follows the map zoom, clamped to [minPx, 90% of the smaller viewport side]. */
export function boardPx(mapZoom: number, boardZoom: number, view: Viewport, minPx: number): number {
  const raw = NOMINAL_PX * 2 ** (mapZoom - boardZoom);
  const hi = 0.9 * Math.min(view.width, view.height);
  return Math.min(hi, Math.max(minPx, raw));
}

/** Room the back / forward buttons take beside the board: two buttons of 36px, their 6px margins and some slack. */
const NAV_BUTTONS_PX = 96;

/** Mobile board width after focusing: as large as fits next to the back / forward buttons (and the lower half of the screen). */
export function mobileFocusPx(view: Viewport): number {
  return Math.min(view.width - NAV_BUTTONS_PX, 0.46 * view.height);
}

/** Zoom that renders a board of zoom `boardZoom` at `px` wide, within the camera limits. */
export function focusZoom(o: { boardZoom: number; px: number; minZoom: number; maxZoom: number }): number {
  const target = o.boardZoom + Math.log2(o.px / NOMINAL_PX);
  return Math.min(o.maxZoom, Math.max(o.minZoom, target));
}

/**
 * Resize-grip drag. `desiredPx` is the board width the pointer asks for at the drag-start zoom `z0`
 * (board zoom `bz0`). Inside [minPx, maxPx] the camera stays; beyond, it zooms out (grow) or in
 * (shrink) so the rendered board stays pinned at the limit while the board's world size keeps changing.
 * Once the camera hits its zoom limit the size stops changing. `extra` is the log2 growth to add to sizeDelta.
 */
export function gripResize(o: {
  z0: number; bz0: number; desiredPx: number; minPx: number; maxPx: number; minZoom: number; maxZoom: number;
}): { mapZoom: number; extra: number } {
  const { z0, desiredPx, minPx, maxPx } = o;
  let mapZoom = z0;
  let px = desiredPx;
  if (desiredPx > maxPx) {
    mapZoom = Math.min(o.maxZoom, Math.max(o.minZoom, z0 - Math.log2(desiredPx / maxPx)));
    px = maxPx * 2 ** (z0 - mapZoom);
  } else if (desiredPx < minPx) {
    mapZoom = Math.min(o.maxZoom, Math.max(o.minZoom, z0 + Math.log2(minPx / desiredPx)));
    px = minPx / 2 ** (mapZoom - z0);
  }
  return { mapZoom, extra: o.bz0 - z0 + Math.log2(px / NOMINAL_PX) };
}

import { getNode, type ChessMap, type NodeId } from './types';
import { pathTo } from './tree';

/** Rendered board width (px) when the map zoom equals the board's zoom. */
export const NOMINAL_PX = 320;
export const DEFAULT_BOARD_ZOOM = 1.5;

export const rootBoardZoom = (map: ChessMap): number => map.boardZoom ?? DEFAULT_BOARD_ZOOM;

/** Sum of the log2 size deltas from the root down to the node. */
export const sizeSum = (map: ChessMap, nodeId: NodeId): number =>
  pathTo(map, nodeId).reduce((s, id) => s + (getNode(map, id).sizeDelta ?? 0), 0);

/** Map zoom at which this node's board renders at NOMINAL_PX. A positive delta means a bigger board (lower zoom). */
export const effectiveBoardZoom = (map: ChessMap, nodeId: NodeId): number => rootBoardZoom(map) - sizeSum(map, nodeId);

export interface Viewport { width: number; height: number }

/** Rendered board width: follows the map zoom, clamped to [minPx, 90% of the smaller viewport side]. */
export function boardPx(mapZoom: number, boardZoom: number, view: Viewport, minPx: number): number {
  const raw = NOMINAL_PX * 2 ** (mapZoom - boardZoom);
  const hi = 0.9 * Math.min(view.width, view.height);
  return Math.min(hi, Math.max(minPx, raw));
}

/** The comfortable board size after focusing (desktop / mobile formulas). */
export function comfortPx(view: Viewport, mobile: boolean): number {
  return mobile ? Math.min(0.86 * view.width, 0.46 * view.height) : Math.max(240, Math.min(480, 0.26 * view.width, 0.42 * view.height));
}

/**
 * Highest zoom at which child offsets (Mercator units, 1 = whole world) stay within
 * `halfW` / `halfH` pixels of the board centre. Infinity when there are none.
 */
export function maxZoomToFit(offsets: { dx: number; dy: number }[], halfW: number, halfH: number): number {
  let z = Infinity;
  for (const { dx, dy } of offsets) {
    if (dx > 0) z = Math.min(z, Math.log2(halfW / (512 * dx)));
    if (dy > 0) z = Math.min(z, Math.log2(halfH / (512 * dy)));
  }
  return z;
}

/** Zoom to use on focus: the board at its comfortable size, zoomed out if the children would not fit. */
export function focusZoom(o: { boardZoom: number; comfort: number; fit: number; minZoom: number; maxZoom: number }): number {
  const target = o.boardZoom + Math.log2(o.comfort / NOMINAL_PX);
  return Math.min(o.maxZoom, Math.max(o.minZoom, Math.min(target, o.fit)));
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

import type maplibregl from 'maplibre-gl';
import { getNode } from '../model/types';
import { boardPx, effectiveBoardZoom, gripResize } from '../model/scale';
import { activeMap, getState, setBoardSize } from '../store/store';
import { wrapNear } from '../geo/lngLat';
import { minBoardPx, visibleSize } from './mapView';

export interface BoardSizer {
  /** Re-reads the size now (after a cursor or map change). */
  apply: () => void;
}

/**
 * Board size: follows the map zoom (see model/scale) through the card's `--board-size`.
 * The `grip` resizes the current board in Edit mode, zooming the camera when it reaches the clamp.
 */
export function createBoardSizer(map: maplibregl.Map, card: HTMLElement, grip: HTMLElement, onResize: () => void): BoardSizer {
  let liveExtra = 0; // log2 growth while the resize grip is dragged
  let lastPx = 0;

  function apply(): void {
    const zoom = effectiveBoardZoom(activeMap(), getState().cursor.nodeId) - liveExtra;
    const px = Math.round(boardPx(map.getZoom(), zoom, visibleSize(map), minBoardPx()));
    if (px === lastPx) return;
    lastPx = px;
    card.style.setProperty('--board-size', px + 'px');
    onResize();
  }

  let frame = 0;
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(() => ((frame = 0), apply()));
  };
  map.on('zoom', schedule);
  map.on('resize', schedule);

  /** Sets the zoom while the board stays at the same place on screen. */
  function zoomAroundBoard(zoom: number): void {
    const ll = getNode(activeMap(), getState().cursor.nodeId).lngLat;
    const at: [number, number] = [wrapNear(ll[0], map.getCenter().lng), ll[1]];
    const before = map.project(at);
    map.jumpTo({ zoom });
    const after = map.project(at);
    const cp = map.project(map.getCenter());
    map.jumpTo({ center: map.unproject([cp.x + after.x - before.x, cp.y + after.y - before.y]) });
  }

  grip.addEventListener('pointerdown', (e) => {
    if (getState().mode !== 'edit' || e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const id = getState().cursor.nodeId;
    const start = { x: e.clientX, y: e.clientY, px: lastPx, z0: map.getZoom(), bz0: effectiveBoardZoom(activeMap(), id) };
    const move = (ev: PointerEvent): void => {
      const view = visibleSize(map);
      const r = gripResize({
        ...start,
        desiredPx: Math.max(20, start.px + (ev.clientX - start.x) + (ev.clientY - start.y)),
        minPx: minBoardPx(),
        maxPx: 0.9 * Math.min(view.width, view.height),
        minZoom: map.getMinZoom(),
        maxZoom: map.getMaxZoom(),
      });
      liveExtra = r.extra;
      if (Math.abs(r.mapZoom - map.getZoom()) > 1e-9) zoomAroundBoard(r.mapZoom);
      apply();
    };
    const end = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      const total = (getNode(activeMap(), id).sizeDelta ?? 0) + liveExtra;
      liveExtra = 0;
      setBoardSize(id, total); // snaps to 0.25 and commits once
      apply();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });

  return { apply };
}

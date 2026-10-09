import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import type { LngLat, SavedView } from '../model/types';
import { activeMap, getState, saveView, subscribe } from '../store/store';
import { getNode } from '../model/types';
import { comfortPx, effectiveBoardZoom, focusZoom, maxZoomToFit } from '../model/scale';

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const INITIAL_ZOOM = 1.2;

export const isMobile = (): boolean => window.matchMedia('(max-width: 767px)').matches;

/** Shifts `lng` by multiples of 360 so it is as close as possible to `ref`. */
export const wrapNear = (lng: number, ref: number): number => lng + 360 * Math.round((ref - lng) / 360);

export function padding(): maplibregl.PaddingOptions {
  const bar = document.querySelector<HTMLElement>('.topbar');
  return { top: bar?.offsetHeight ?? 0, bottom: isMobile() ? 72 : 0, left: 0, right: 0 };
}

function viewOfActive(): SavedView {
  const map = activeMap();
  return map.view ?? { center: getNode(map, map.rootId).lngLat, zoom: INITIAL_ZOOM };
}

export function createMapView(container: HTMLElement): maplibregl.Map {
  const view = viewOfActive();
  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: view.center,
    zoom: view.zoom,
    renderWorldCopies: true,
    dragRotate: false,
    pitchWithRotate: false,
    doubleClickZoom: true,
    clickTolerance: 5,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('style.load', () => map.setProjection({ type: 'mercator' }));
  map.on('error', (e) => console.warn('map error', e.error?.message ?? e));
  map.setPadding(padding());
  // MapLibre skips its first ResizeObserver tick, so a container sized after construction
  // (e.g. dev-mode CSS injection) would leave the default 400×300 canvas. Resize explicitly.
  new ResizeObserver(() => {
    map.resize();
    map.setPadding(padding());
  }).observe(container);
  map.once('load', () => map.resize());

  let timer: ReturnType<typeof setTimeout> | undefined;
  map.on('moveend', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const c = map.getCenter();
      saveView({ center: [c.lng, c.lat], zoom: map.getZoom() });
    }, 500);
  });

  // Follow focus() and map switches.
  let lastRecenter = getState().recenter;
  let lastMapId = getState().activeMapId;
  subscribe(() => {
    const s = getState();
    if (s.activeMapId !== lastMapId) {
      lastMapId = s.activeMapId;
      lastRecenter = s.recenter;
      const v = viewOfActive();
      map.jumpTo({ center: v.center, zoom: v.zoom });
    } else if (s.recenter !== lastRecenter) {
      lastRecenter = s.recenter;
      focusView(map);
    }
  });
  return map;
}

const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) / (2 * Math.PI);

/** Highest zoom at which all child pins of the cursor node stay in the visible area around the node. */
export function fitZoom(map: maplibregl.Map): number {
  const m = activeMap();
  const { cursor } = getState();
  const node = getNode(m, cursor.nodeId);
  if (cursor.ply !== node.plies.length) return Infinity;
  const pad = padding();
  const c = map.getContainer();
  const halfW = Math.max(40, c.clientWidth / 2 - 80);
  const halfH = Math.max(40, (c.clientHeight - (pad.top ?? 0) - (pad.bottom ?? 0)) / 2 - 30);
  const offsets = node.children.map((id) => {
    const ll = getNode(m, id).lngLat;
    return {
      dx: Math.abs(wrapNear(ll[0], node.lngLat[0]) - node.lngLat[0]) / 360,
      dy: Math.abs(mercY(ll[1]) - mercY(node.lngLat[1])),
    };
  });
  return maxZoomToFit(offsets, halfW, halfH);
}

/** Zoom that shows the cursor's board at its comfortable size (zooming in or out), unless its children would not fit. */
export function targetZoom(map: maplibregl.Map): number {
  const { cursor } = getState();
  return focusZoom({
    boardZoom: effectiveBoardZoom(activeMap(), cursor.nodeId),
    comfort: comfortPx({ width: window.innerWidth, height: window.innerHeight }, isMobile()),
    fit: fitZoom(map),
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom(),
  });
}

/** Centers the cursor node below the top bar at the zoom given by targetZoom. */
export function focusView(map: maplibregl.Map): void {
  const at = getNode(activeMap(), getState().cursor.nodeId).lngLat;
  map.easeTo({ center: [wrapNear(at[0], map.getCenter().lng), at[1]], zoom: targetZoom(map), padding: padding(), duration: 400 });
}

/** Centers a point in the visible area (below the top bar), keeping the zoom. */
export function easeToNode(map: maplibregl.Map, at: LngLat): void {
  map.easeTo({ center: [wrapNear(at[0], map.getCenter().lng), at[1]], padding: padding(), duration: 400 });
}

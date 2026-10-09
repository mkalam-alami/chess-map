import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import { getNode, type LngLat, type SavedView } from '../model/types';
import { activeMap, getState, saveView, setCentered, subscribe } from '../store/store';
import { comfortPx, effectiveBoardZoom, focusZoom, maxZoomToFit, type Viewport } from '../model/scale';
import { wrapNear } from '../geo/lngLat';

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const INITIAL_ZOOM = 1.2;

export const isMobile = (): boolean => window.matchMedia('(max-width: 767px)').matches;

/** Smallest rendered board width (px). */
export const minBoardPx = (): number => (isMobile() ? 80 : 100);

export function padding(): maplibregl.PaddingOptions {
  const bar = document.querySelector<HTMLElement>('.topbar');
  return { top: bar?.offsetHeight ?? 0, bottom: isMobile() ? 72 : 0, left: 0, right: 0 };
}

/** Size of the map area left visible by the top bar and the bottom controls. */
export function visibleSize(map: maplibregl.Map): Viewport {
  const c = map.getContainer();
  const pad = padding();
  return { width: c.clientWidth, height: c.clientHeight - (pad.top ?? 0) - (pad.bottom ?? 0) };
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
    keyboard: false, // arrow keys navigate the repertoire instead of panning
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

  // Centered mode: zooming keeps the board in the middle; panning the map leaves it.
  map.on('dragstart', () => setCentered(false));
  map.on('boxzoomend', () => setCentered(false));
  map.on('dblclick', () => getState().centered && map.zoomIn({ duration: 300 })); // MapLibre's own double-click zoom is off while centered
  const anchorZoom = (centered: boolean): void => {
    const opts = centered ? { around: 'center' as const } : undefined;
    map.scrollZoom.disable();
    map.scrollZoom.enable(opts);
    map.touchZoomRotate.disable();
    map.touchZoomRotate.enable(opts);
    if (centered) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  };
  /** After a view restore: centered only if the board really is in the middle. */
  const syncCentered = (): void => {
    const at = map.project(getNode(activeMap(), getState().cursor.nodeId).lngLat);
    const mid = map.project(map.getCenter());
    setCentered(Math.abs(at.x - mid.x) < 2 && Math.abs(at.y - mid.y) < 2);
  };
  syncCentered();
  let lastCentered = getState().centered;
  anchorZoom(lastCentered);

  // Follow focus() and map switches.
  let lastRecenter = getState().recenter;
  let lastMapId = getState().activeMapId;
  let lastBoardZoom = effectiveBoardZoom(activeMap(), getState().cursor.nodeId);
  subscribe(() => {
    const s = getState();
    const prevBoardZoom = lastBoardZoom;
    lastBoardZoom = effectiveBoardZoom(activeMap(), s.cursor.nodeId);
    if (s.activeMapId !== lastMapId) {
      lastMapId = s.activeMapId;
      lastRecenter = s.recenter;
      const v = viewOfActive();
      map.jumpTo({ center: v.center, zoom: v.zoom });
      syncCentered();
    } else if (s.recenter !== lastRecenter) {
      lastRecenter = s.recenter;
      // Arrow-key navigation keeps the board the same size on screen rather than fitting the children, and jumps without easing.
      focusView(map, s.keepSize ? map.getZoom() - prevBoardZoom + lastBoardZoom : undefined, s.keepSize);
    } else if (s.centered && !lastCentered) {
      easeToNode(map, getNode(activeMap(), s.cursor.nodeId).lngLat); // "Back to board"
    }
    if (s.centered !== lastCentered) {
      lastCentered = s.centered;
      anchorZoom(lastCentered);
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
  const view = visibleSize(map);
  const halfW = Math.max(40, view.width / 2 - 80);
  const halfH = Math.max(40, view.height / 2 - 30);
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

/** Centers the cursor node below the top bar at `zoom`, by default the one given by targetZoom. `instant` skips the animation. */
export function focusView(map: maplibregl.Map, zoom?: number, instant = false): void {
  const at = getNode(activeMap(), getState().cursor.nodeId).lngLat;
  const z = zoom === undefined ? targetZoom(map) : Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), zoom));
  map.easeTo({ center: [wrapNear(at[0], map.getCenter().lng), at[1]], zoom: z, padding: padding(), duration: instant ? 0 : 400 });
}

/** Centers a point in the visible area (below the top bar), keeping the zoom. */
export function easeToNode(map: maplibregl.Map, at: LngLat): void {
  map.easeTo({ center: [wrapNear(at[0], map.getCenter().lng), at[1]], padding: padding(), duration: 400 });
}

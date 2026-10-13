import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Relative path: the package's exports map hides dist/. Bundled as an asset, so no external script is fetched.
import rtlTextPluginUrl from '../../../../node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import { wrapNear, type LngLat, type SavedView } from '../../../domain';
import type { ChessMapApp } from '../../../application';
import type { ViewState } from '../viewState';
import { focusZoom, mobileFocusPx, type Viewport } from './viewMath';

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

function viewOfActive(app: ChessMapApp): SavedView {
  const rep = app.session.repertoire;
  return rep.view ?? { center: rep.node(rep.rootId).lngLat, zoom: INITIAL_ZOOM };
}

/** Zoom below which country names are hidden (about when France fits on screen): at that scale they only compete with the pins. */
const COUNTRY_LABELS_MIN_ZOOM = 5;

/** Raises the minzoom of the style's country label layers (matched by id: the style is third-party). */
function hideCountryLabelsWhenFar(map: maplibregl.Map): void {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol' || !/country/i.test(layer.id)) continue;
    map.setLayerZoomRange(layer.id, Math.max(layer.minzoom ?? 0, COUNTRY_LABELS_MIN_ZOOM), layer.maxzoom ?? 24);
  }
}

/** A two-finger gesture pans too, but it is a pinch/zoom, not the user leaving the board. */
const isPinch = (e: Event | undefined): boolean => !!e && 'touches' in e && (e as TouchEvent).touches.length > 1;

export function createMapView(container: HTMLElement, app: ChessMapApp, vs: ViewState): maplibregl.Map {
  const view = viewOfActive(app);
  // Lazy: the bundled plugin is only fetched once a tile contains right-to-left text (Arabic, Hebrew...).
  void maplibregl.setRTLTextPlugin(rtlTextPluginUrl, true).catch(() => {});
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
  map.on('style.load', () => {
    map.setProjection({ type: 'mercator' });
    hideCountryLabelsWhenFar(map);
  });
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
      app.rememberView({ center: [c.lng, c.lat], zoom: map.getZoom() });
    }, 500);
  });

  // Centered mode: zooming keeps the board in the middle; panning the map leaves it.
  map.on('dragstart', (e) => {
    vs.setCentered(false);
    if (!isPinch(e.originalEvent)) vs.closeBoard();
  });
  map.on('boxzoomend', () => vs.setCentered(false));
  // Clicking the bare map drops the board's focus. Markers and controls own their clicks (a pin click focuses, so it must not close).
  // Registered before the placing click handler so a click that drops a pin is still seen as busy and ignored.
  map.on('click', (e) => {
    if (!(e.originalEvent.target as Element | null)?.closest('.maplibregl-marker, .maplibregl-ctrl, .maplibregl-popup')) vs.closeBoard();
  });
  map.on('dblclick', () => vs.centered && map.zoomIn({ duration: 300 })); // MapLibre's own double-click zoom is off while centered
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
    const at = map.project(app.session.repertoire.node(app.session.cursor.nodeId).lngLat);
    const mid = map.project(map.getCenter());
    vs.setCentered(Math.abs(at.x - mid.x) < 2 && Math.abs(at.y - mid.y) < 2);
  };
  syncCentered();
  let lastCentered = vs.centered;
  anchorZoom(lastCentered);

  // Follow focus() and map switches.
  let lastRecenter = vs.recenter;
  let lastMapId = app.session.library.activeId;
  let lastBoardZoom = app.session.repertoire.effectiveBoardZoom(app.session.cursor.nodeId);
  vs.subscribe(() => {
    const { cursor, library, repertoire } = app.session;
    const prevBoardZoom = lastBoardZoom;
    lastBoardZoom = repertoire.effectiveBoardZoom(cursor.nodeId);
    if (library.activeId !== lastMapId) {
      lastMapId = library.activeId;
      lastRecenter = vs.recenter;
      const v = viewOfActive(app);
      map.jumpTo({ center: v.center, zoom: v.zoom });
      syncCentered();
    } else if (vs.recenter !== lastRecenter) {
      lastRecenter = vs.recenter;
      // Selecting a board only centers it on desktop (phones zoom to a fixed level). Arrow-key navigation keeps the board the same size on screen rather than fitting the children, and jumps without easing.
      focusView(map, app, vs.keepSize ? map.getZoom() - prevBoardZoom + lastBoardZoom : undefined, vs.keepSize);
    } else if (vs.centered && !lastCentered) {
      easeToNode(map, repertoire.node(cursor.nodeId).lngLat); // "Back to board"
    }
    if (vs.centered !== lastCentered) {
      lastCentered = vs.centered;
      anchorZoom(lastCentered);
    }
  });
  return map;
}

/** Zoom that fits the cursor's board and its back / forward buttons on a phone, whatever the current zoom. */
function mobileZoom(map: maplibregl.Map, app: ChessMapApp): number {
  const { cursor, repertoire } = app.session;
  return focusZoom({
    boardZoom: repertoire.effectiveBoardZoom(cursor.nodeId),
    px: mobileFocusPx({ width: window.innerWidth, height: window.innerHeight }),
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom(),
  });
}

/** Centers the cursor node below the top bar at `zoom`, by default the current one (a fixed one on phones). `instant` skips the animation. */
function focusView(map: maplibregl.Map, app: ChessMapApp, zoom?: number, instant = false): void {
  const at = app.session.repertoire.node(app.session.cursor.nodeId).lngLat;
  const z = zoom === undefined ? (isMobile() ? mobileZoom(map, app) : map.getZoom()) : Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), zoom));
  map.easeTo({ center: [wrapNear(at[0], map.getCenter().lng), at[1]], zoom: z, padding: padding(), duration: instant ? 0 : 400 });
}

/** Centers a point in the visible area (below the top bar), keeping the zoom. */
function easeToNode(map: maplibregl.Map, at: LngLat): void {
  map.easeTo({ center: [wrapNear(at[0], map.getCenter().lng), at[1]], padding: padding(), duration: 400 });
}

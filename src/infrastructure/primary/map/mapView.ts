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
import { boardPx, comfortPx, fitAround, focusZoom, maxZoomToFit, type Viewport } from './viewMath';

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
  map.on('dragstart', () => vs.setCentered(false));
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
  // "Back to board" is also offered when the zoom differs from the one a board gets on open (zoomed by hand, or fitted on the children).
  const syncZoom = (): void => vs.setAtDefaultZoom(isAtBoardZoom(map, app));
  map.on('moveend', syncZoom);
  map.once('load', syncZoom);
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
      // Arrow-key navigation keeps the board the same size on screen rather than fitting the children, and jumps without easing.
      focusView(map, app, vs.keepSize ? map.getZoom() - prevBoardZoom + lastBoardZoom : undefined, vs.keepSize);
    } else if (vs.centered && !lastCentered) {
      easeToNode(map, repertoire.node(cursor.nodeId).lngLat); // "Back to board"
    }
    if (vs.centered !== lastCentered) {
      lastCentered = vs.centered;
      anchorZoom(lastCentered);
    }
    if (!map.isMoving()) syncZoom(); // mid-ease the zoom is transient: moveend reports it
  });
  return map;
}

const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) / (2 * Math.PI);

/** Highest zoom at which all child pins of the cursor node stay in the visible area around the node. */
function fitZoom(map: maplibregl.Map, app: ChessMapApp): number {
  const m = app.session.repertoire;
  const { cursor } = app.session;
  const node = m.node(cursor.nodeId);
  if (cursor.played !== node.moves.length) return Infinity;
  const view = visibleSize(map);
  const halfW = Math.max(40, view.width / 2 - 80);
  const halfH = Math.max(40, view.height / 2 - 30);
  const offsets = node.children.map((id) => {
    const ll = m.node(id).lngLat;
    return {
      dx: Math.abs(wrapNear(ll[0], node.lngLat[0]) - node.lngLat[0]) / 360,
      dy: Math.abs(mercY(ll[1]) - mercY(node.lngLat[1])),
    };
  });
  return maxZoomToFit(offsets, halfW, halfH);
}

export interface ZoomOptions {
  /** Use the mobile comfort size (board fills the width, nav buttons visible) whatever the screen. Default: the current screen. */
  mobile?: boolean;
  /**
   * Zoom out until all child markers are in view. Default: yes on desktop, except on the root board (fitting the root's children
   * is the job of the "Start position" button); never on mobile, where every focus (pin click, recording) gets the standard zoom.
   */
  fitChildren?: boolean;
}

/** Zoom that shows the cursor's board at its comfortable size (zooming in or out), unless its children would not fit. */
function targetZoom(map: maplibregl.Map, app: ChessMapApp, { mobile = isMobile(), fitChildren }: ZoomOptions = {}): number {
  const { cursor, repertoire } = app.session;
  const fit = fitChildren ?? (!mobile && cursor.nodeId !== repertoire.rootId);
  return focusZoom({
    boardZoom: repertoire.effectiveBoardZoom(cursor.nodeId),
    comfort: comfortPx({ width: window.innerWidth, height: window.innerHeight }, mobile),
    fit: fit ? fitZoom(map, app) : Infinity,
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom(),
  });
}

/** True when the camera zoom is the one a board gets on open (this screen's) or the standard one (what "Back to board" applies). */
export function isAtBoardZoom(map: maplibregl.Map, app: ChessMapApp): boolean {
  const z = map.getZoom();
  return [targetZoom(map, app), targetZoom(map, app, { mobile: true, fitChildren: false })].some((t) => Math.abs(t - z) < 0.05);
}

/**
 * Centers the cursor's board and gives it the standard zoom: the one a board gets when opened on mobile, on every screen.
 * Reusable by any control that brings the user (back) to a board.
 */
export function focusOnBoard(map: maplibregl.Map, app: ChessMapApp): void {
  focusView(map, app, targetZoom(map, app, { mobile: true, fitChildren: false }));
}

/** Room (px) a marker needs around its anchor: the pin, and the note box when the note is pinned to the map. */
const PIN_ROOM = { mx: 56, my: 56 };
const NOTE_ROOM = { mx: 120, my: 56 };
/** Room (px) the board's nav buttons (sides) and its opening / place / note labels (above, below) take around the card. */
const BOARD_SIDE_PX = 46;
const BOARD_LABELS_PX = 56;

/**
 * Frames the starting position: the root board at the standard zoom, zoomed out only as far as needed to also show every child
 * marker and every marker with a note pinned to the map. The camera centres on that whole group, not on the board.
 * Returns true when the group is centred on the board anyway (nothing else to show), i.e. the map is still "centered".
 */
export function focusOnStart(map: maplibregl.Map, app: ChessMapApp): boolean {
  const m = app.session.repertoire;
  const root = m.node(m.rootId);
  const ids = new Set<string>(root.children);
  for (const n of m.nodes()) if (n.noteShown && n.note) ids.add(n.id);
  ids.delete(root.id);
  const points = [...ids].map((id) => {
    const n = m.node(id);
    return {
      dx: (wrapNear(n.lngLat[0], root.lngLat[0]) - root.lngLat[0]) / 360,
      dy: mercY(n.lngLat[1]) - mercY(root.lngLat[1]),
      ...(n.noteShown && n.note ? NOTE_ROOM : PIN_ROOM),
    };
  });
  const view = visibleSize(map);
  const bz = m.effectiveBoardZoom(root.id);
  const comfort = comfortPx({ width: window.innerWidth, height: window.innerHeight }, true);
  const fit = fitAround({
    points,
    boardHalf: (zoom) => {
      const half = boardPx(zoom, bz, view, minBoardPx()) / 2;
      return { x: half + BOARD_SIDE_PX, y: half + BOARD_LABELS_PX };
    },
    width: view.width,
    height: view.height,
    minZoom: map.getMinZoom(),
    maxZoom: Math.min(map.getMaxZoom(), focusZoom({ boardZoom: bz, comfort, fit: Infinity, minZoom: map.getMinZoom(), maxZoom: map.getMaxZoom() })),
  });
  const lat = Math.atan(Math.exp(2 * Math.PI * (mercY(root.lngLat[1]) + fit.dy)));
  map.easeTo({
    center: [root.lngLat[0] + fit.dx * 360, Math.max(-85, Math.min(85, (2 * lat - Math.PI / 2) * (180 / Math.PI)))],
    zoom: fit.zoom,
    padding: padding(),
    duration: 400,
  });
  return Math.abs(fit.dx) + Math.abs(fit.dy) < 1e-9;
}

/** Centers the cursor node below the top bar at `zoom`, by default the one given by targetZoom. `instant` skips the animation. */
function focusView(map: maplibregl.Map, app: ChessMapApp, zoom?: number, instant = false): void {
  const at = app.session.repertoire.node(app.session.cursor.nodeId).lngLat;
  const z = zoom === undefined ? targetZoom(map, app) : Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), zoom));
  map.easeTo({ center: [wrapNear(at[0], map.getCenter().lng), at[1]], zoom: z, padding: padding(), duration: instant ? 0 : 400 });
}

/** Centers a point in the visible area (below the top bar), keeping the zoom. */
function easeToNode(map: maplibregl.Map, at: LngLat): void {
  map.easeTo({ center: [wrapNear(at[0], map.getCenter().lng), at[1]], padding: padding(), duration: 400 });
}

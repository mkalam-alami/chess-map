import './style.css';
import { flushSave, loadLibrary } from './store/persist';
import { activeMap, back, beginRelocate, forward, getState, init, subscribe, toggleMode, togglePin, undoPly, canUndoPly } from './store/store';
import { createMapView } from './map/mapView';
import { createBoardMarker } from './map/boardMarker';
import { createPinMarkers } from './map/pinMarker';
import { createCurveLayer } from './map/curveLayer';
import { createNavButtons, createTopBar } from './ui/topBar';
import { isTyping } from './ui/dom';
import { closePopover } from './ui/popover';
import { createPlacing } from './map/placing';
import { createLocate } from './ui/locate';
import { createRelocateGhost } from './map/relocating';
import { wireIntegrations } from './integration';

// Autosave is debounced: make sure the last change survives closing / reloading the tab.
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSave());

const app = document.getElementById('app') as HTMLElement;

const saved = loadLibrary();
if (saved) init(saved);

const mapEl = document.createElement('div');
mapEl.id = 'map';
app.append(mapEl);

const topBar = createTopBar(() => {
  const c = map.getCenter();
  return [c.lng, c.lat];
});
const nav = createNavButtons();
app.append(topBar.el, nav.el);
topBar.update();
nav.update();

// Markers are added right away so board and pins work even before tiles/style load.
const map = createMapView(mapEl);
const board = createBoardMarker(map);
const pins = createPinMarkers(map);
createCurveLayer(map);
createPlacing(map, app);
createRelocateGhost(map);
createLocate(app, map);
wireIntegrations(map);

let lastCursor = getState().cursor;
subscribe(() => {
  const c = getState().cursor;
  if (c.nodeId !== lastCursor.nodeId || c.ply !== lastCursor.ply) closePopover();
  lastCursor = c;
  topBar.update();
  nav.update();
  board.update();
  pins.update();
});

window.addEventListener('keydown', (e) => {
  if (getState().placing || getState().relocating || isTyping(e.target) || e.altKey || document.querySelector('dialog[open]')) return;
  const edit = getState().mode === 'edit';
  const key = e.key.toLowerCase();
  if (e.key === 'ArrowLeft') back();
  else if (e.key === 'ArrowRight') forward();
  else if (!e.ctrlKey && !e.metaKey && key === 'e') toggleMode();
  else if (!e.ctrlKey && !e.metaKey && key === 'p' && edit) togglePin();
  else if (!e.ctrlKey && !e.metaKey && key === 'l' && edit) beginRelocate(getState().cursor.nodeId);
  else if (edit && ((key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace')) {
    if (canUndoPly()) undoPly();
  } else return;
  e.preventDefault();
});

// Test/debug handle.
(window as unknown as Record<string, unknown>).__chessMap = { map, activeMap, getState };

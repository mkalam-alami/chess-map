import './style.css';
import { flushSave, loadLibrary } from './store/persist';
import { activeMap, back, beginRelocate, canUndoPly, forward, getState, init, subscribe, toggleMode, togglePin, undoPly } from './store/store';
import { sameCursor } from './model/cursor';
import { createMapView } from './map/mapView';
import { createBoardMarker } from './map/boardMarker';
import { createPinMarkers } from './map/pinMarker';
import { createCurveLayer } from './map/curveLayer';
import { mountUi } from './ui/App';
import { confirmDeleteNode } from './ui/confirmDelete';
import { isTyping } from './ui/dom';
import { closePopover } from './ui/overlay';
import { createPlacing } from './map/placing';
import { openingsLoaded } from './ui/hooks';
import { createRelocateGhost } from './map/relocating';
import { loadOpenings } from './chess/openings';
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

// Markers are added right away so board and pins work even before tiles/style load.
const map = createMapView(mapEl);
createBoardMarker(map);
const pins = createPinMarkers(map);
createCurveLayer(map);
createPlacing(map, app);
createRelocateGhost(map);
wireIntegrations(map);

// The Preact UI re-renders itself on store changes.
const ui = document.createElement('div');
ui.id = 'ui';
app.append(ui);
mountUi(ui, map);

let lastCursor = getState().cursor;
subscribe(() => {
  if (!sameCursor(getState().cursor, lastCursor)) closePopover();
  lastCursor = getState().cursor;
});

// Opening names load lazily (separate chunk); refresh the UI once available.
void loadOpenings().then(() => {
  openingsLoaded.set(openingsLoaded.get() + 1);
  pins.update();
});

window.addEventListener('keydown', (e) => {
  if (getState().placing || getState().relocating || isTyping(e.target) || e.altKey || document.querySelector('dialog[open]')) return;
  const edit = getState().mode === 'edit' && getState().boardOpen; // board tools need a visible board
  const key = e.key.toLowerCase();
  const plain = !e.ctrlKey && !e.metaKey;
  if (e.key === 'ArrowLeft') back();
  else if (e.key === 'ArrowRight') forward();
  else if (plain && key === 'e') toggleMode();
  else if (plain && key === 'p' && edit) togglePin();
  else if (plain && key === 'l' && edit) beginRelocate(getState().cursor.nodeId);
  else if (edit && e.key === 'Delete') void confirmDeleteNode(getState().cursor.nodeId);
  else if (edit && ((key === 'z' && !plain) || e.key === 'Backspace')) {
    if (canUndoPly()) undoPly();
  } else return;
  e.preventDefault();
});

// Test/debug handle (typed in tests/e2e/helpers.ts).
(window as unknown as Record<string, unknown>).__chessMap = { map, activeMap, getState };

import './style.css';
import { activeMap, app, back, beginRelocate, canUndoPly, forward, getState, subscribe, toggleMode, togglePin, undoPly } from './store/store';
import { sameCursor } from './domain';
import { createMapView } from './map/mapView';
import { createBoardMarker } from './map/boardMarker';
import { createPinMarkers } from './map/pinMarker';
import { createCurveLayer } from './map/curveLayer';
import { mountUi } from './ui/App';
import { confirmDeleteNode } from './ui/confirmDelete';
import { isTyping } from './ui/dom';
import { closePopover } from './ui/overlay';
import { createPlacing } from './map/placing';
import { createRelocateGhost } from './map/relocating';
import { wireIntegrations } from './integration';

// Autosave is debounced: make sure the last change survives closing / reloading the tab.
window.addEventListener('pagehide', () => app.flush());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && app.flush());

// Load the stored library before any view reads the state; opening names and the root's place arrive later and notify.
void app.start();

const appEl = document.getElementById('app') as HTMLElement;

const mapEl = document.createElement('div');
mapEl.id = 'map';
appEl.append(mapEl);

// Markers are added right away so board and pins work even before tiles/style load.
const map = createMapView(mapEl);
createBoardMarker(map);
createPinMarkers(map);
createCurveLayer(map);
createPlacing(map, appEl);
createRelocateGhost(map);
wireIntegrations(map);

// The Preact UI re-renders itself on store changes.
const ui = document.createElement('div');
ui.id = 'ui';
appEl.append(ui);
mountUi(ui, map);

let lastCursor = getState().cursor;
subscribe(() => {
  if (!sameCursor(getState().cursor, lastCursor)) closePopover();
  lastCursor = getState().cursor;
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

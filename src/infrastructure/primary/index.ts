import type { ChessMapApp } from '../../application';
import { sameCursor } from '../../domain';
import { createBoardMarker } from './map/boardMarker';
import { createCurveLayer } from './map/curveLayer';
import { createDragPreview } from './map/dragPreview';
import { createMapView } from './map/mapView';
import { createPinMarkers } from './map/pinMarker';
import { createPlacing } from './map/placing';
import { createRelocateGhost } from './map/relocating';
import { mountUi } from './ui/App';
import { closePopover } from './ui/overlay';
import { installKeyboard } from './keyboard';
import { ViewState } from './viewState';

/**
 * Builds everything the user touches inside `appElement` (map, board, pins, Preact UI, keyboard) on top of a started `app`.
 * The app and the view state are handed down explicitly: there are no module-level singletons.
 */
export function startPrimary(appElement: HTMLElement, app: ChessMapApp): void {
  const vs = new ViewState(app);
  const preview = createDragPreview();

  const mapEl = document.createElement('div');
  mapEl.id = 'map';
  appElement.append(mapEl);

  // Markers are added right away so board and pins work even before tiles/style load.
  const map = createMapView(mapEl, app, vs);
  createBoardMarker(map, app, vs, preview);
  createPinMarkers(map, app, vs, preview);
  createCurveLayer(map, app, vs, preview);
  createPlacing(map, appElement, app);
  createRelocateGhost(map, app);

  // The Preact UI re-renders itself on application and view state changes.
  const ui = document.createElement('div');
  ui.id = 'ui';
  appElement.append(ui);
  mountUi(ui, map, app, vs);

  let lastCursor = app.session.cursor;
  app.subscribe(() => {
    if (!sameCursor(app.session.cursor, lastCursor)) closePopover();
    lastCursor = app.session.cursor;
  });

  installKeyboard(app, vs);

  // Test/debug handle (typed in tests/e2e/helpers.ts).
  (window as unknown as Record<string, unknown>).__chessMap = {
    map,
    activeMap: () => app.session.repertoire.data,
    getState: () => ({
      cursor: app.session.cursor, mode: app.session.mode, activeMapId: app.session.library.activeId, pin: app.session.recording,
      placing: app.session.placing, relocating: app.session.relocating, ...vs.state,
    }),
  };
}

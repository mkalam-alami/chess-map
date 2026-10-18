import type maplibregl from 'maplibre-gl';
import { focusOnBoard } from '../map/mapView';
import { Icon } from './Icon';
import { useApp, useViewState } from './hooks';

/**
 * Bottom-left map shortcuts, both at the standard (mobile open-board) zoom:
 *  - "Start position": always there; goes to the root board with every child marker in view, to navigate from it.
 *  - "Back to board": only after the user panned away from the board (leaving centered mode); zooms on the current board alone.
 */
export function MapShortcuts({ map }: { map: maplibregl.Map }) {
  const app = useApp();
  const view = useViewState();
  const toStart = (): void => {
    if (app.session.busy) return;
    app.goTo(app.session.repertoire.rootCursor());
    focusOnBoard(map, app, { fitChildren: true }); // replaces the ease the focus event just started
  };
  const toBoard = (): void => {
    view.setCentered(true);
    focusOnBoard(map, app);
  };
  return (
    <div class="map-shortcuts">
      <button type="button" class="recenter" data-testid="go-to-start" disabled={app.session.busy} title="Go to the starting position" onClick={toStart}>
        <Icon name="flag" />
        <span class="label">Start position</span>
      </button>
      <button type="button" class="recenter" data-testid="back-to-board" hidden={view.centered || !view.boardOpen} title="Center the map on the board again" onClick={toBoard}>
        <Icon name="crosshair" />
        <span class="label">Back to board</span>
      </button>
    </div>
  );
}

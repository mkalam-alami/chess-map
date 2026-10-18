import type maplibregl from 'maplibre-gl';
import { focusOnBoard, focusOnBoardWithMarkers } from '../map/mapView';
import { Icon } from './Icon';
import { useApp, useViewState } from './hooks';

/**
 * Bottom-left map shortcuts, all at the standard (mobile open-board) zoom:
 *  - "Start position": always there; frames the root board with its child markers and the markers with a pinned note.
 *  - "Back to board": after the user panned away from the board or its zoom differs from the default (zoomed by hand, or framed
 *    on the markers); zooms on the current board alone.
 *  - "Show next moves": frames the current board with its immediate children exactly like "Start position" does.
 * Framing does not force the board to the centre of the screen.
 */
export function MapShortcuts({ map }: { map: maplibregl.Map }) {
  const app = useApp();
  const view = useViewState();
  const { cursor, repertoire, busy } = app.session;
  const node = repertoire.node(cursor.nodeId);
  const toStart = (): void => {
    if (busy) return;
    app.goTo(repertoire.rootCursor());
    view.setCentered(focusOnBoardWithMarkers(map, app)); // replaces the ease the focus event just started
  };
  const toBoard = (): void => {
    view.setCentered(true);
    focusOnBoard(map, app);
  };
  const toChildren = (): void => {
    if (!busy) view.setCentered(focusOnBoardWithMarkers(map, app));
  };
  return (
    <div class="map-shortcuts">
      <button type="button" class="recenter" data-testid="go-to-start" disabled={busy} title="Go to the starting position" onClick={toStart}>
        <Icon name="logo" />
        <span class="label">Start position</span>
      </button>
      <button type="button" class="recenter" data-testid="back-to-board" hidden={(view.centered && view.atDefaultZoom) || !view.boardOpen} title="Center the map on the board again" onClick={toBoard}>
        <Icon name="crosshair" />
        <span class="label">Back to board</span>
      </button>
      <button type="button" class="recenter" data-testid="show-next-moves" disabled={busy} hidden={!view.boardOpen || !node.children.length || cursor.played < node.moves.length} title="Show all the next moves" onClick={toChildren}>
        <Icon name="expand" />
        <span class="label">Next moves</span>
      </button>
    </div>
  );
}

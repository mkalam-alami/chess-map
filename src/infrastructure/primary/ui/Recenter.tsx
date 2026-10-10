import { Icon } from './Icon';
import { useViewState } from './hooks';

/** "Back to board": shown only after the user panned away from the board (leaving centered mode). */
export function RecenterButton() {
  const view = useViewState();
  return (
    <button type="button" class="recenter" data-testid="back-to-board" hidden={view.centered} title="Center the map on the board again" onClick={() => view.setCentered(true)}>
      <Icon name="crosshair" />
      <span class="label">Back to board</span>
    </button>
  );
}

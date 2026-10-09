import { setCentered } from '../store/store';
import { Icon } from './Icon';
import { useStore } from './hooks';

/** "Back to board": shown only after the user panned away from the board (leaving centered mode). */
export function RecenterButton() {
  const { centered } = useStore();
  return (
    <button type="button" class="recenter" data-testid="back-to-board" hidden={centered} title="Center the map on the board again" onClick={() => setCentered(true)}>
      <Icon name="crosshair" />
      <span class="label">Back to board</span>
    </button>
  );
}

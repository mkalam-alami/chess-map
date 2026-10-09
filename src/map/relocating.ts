import maplibregl from 'maplibre-gl';
import { activeMap, getState, subscribe } from '../store/store';
import { el } from '../ui/dom';
import { pinLabel } from '../chess/replay';

/** Ghost of the board / pin being relocated, shown at the highlighted search result (same look as the placing ghost). */
export function createRelocateGhost(map: maplibregl.Map): void {
  const ghost = el('div', 'pin pin-ghost relocate-ghost', '', { 'data-testid': 'locate-ghost' });
  const label = el('span', 'pin-label');
  ghost.append(label);
  let marker: maplibregl.Marker | undefined;
  subscribe(() => {
    const r = getState().relocating;
    const node = r?.nodeId ? activeMap().nodes[r.nodeId] : undefined;
    if (r?.preview && node) {
      label.textContent = pinLabel(activeMap(), node);
      marker ??= new maplibregl.Marker({ element: ghost, anchor: 'bottom' }).setLngLat(r.preview).addTo(map);
      marker.setLngLat(r.preview);
    } else if (marker) {
      marker.remove();
      marker = undefined;
    }
  });
}

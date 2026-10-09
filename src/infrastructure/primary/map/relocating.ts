import maplibregl from 'maplibre-gl';
import type { ChessMapApp } from '../../../application';
import { el } from '../ui/dom';

/** Ghost of the board / pin being relocated, shown at the highlighted search result (same look as the placing ghost). */
export function createRelocateGhost(map: maplibregl.Map, app: ChessMapApp): void {
  const ghost = el('div', 'pin pin-ghost relocate-ghost', '', { 'data-testid': 'locate-ghost' });
  const label = el('span', 'pin-label');
  ghost.append(label);
  let marker: maplibregl.Marker | undefined;
  app.subscribe(() => {
    const { relocating: r, repertoire: rep } = app.session;
    const nodeId = r?.nodeId && rep.hasNode(r.nodeId) ? r.nodeId : undefined;
    if (r?.preview && nodeId) {
      label.textContent = rep.pinLabel(nodeId);
      marker ??= new maplibregl.Marker({ element: ghost, anchor: 'bottom' }).setLngLat(r.preview).addTo(map);
      marker.setLngLat(r.preview);
    } else if (marker) {
      marker.remove();
      marker = undefined;
    }
  });
}

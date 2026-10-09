import maplibregl from 'maplibre-gl';
import { moveLabel, sanPath } from '../chess/replay';
import type { LngLat } from '../model/types';
import { activeMap, cancelPlacing, commitPlacing, getState, movePlacing, subscribe, subscribePlacing } from '../store/store';
import { button, el, shieldFromMap } from '../ui/dom';
import { makeDraggable } from './drag';
import { padding } from './mapView';

/** Carry-to-place: a ghost pin follows the pointer (mouse) or can be dragged / tapped into place (touch). */
export function createPlacing(map: maplibregl.Map, app: HTMLElement): void {
  const container = map.getContainer();
  let pointerType = 'mouse';
  container.addEventListener('pointerdown', (e) => (pointerType = e.pointerType), true);
  container.addEventListener('pointermove', (e) => {
    pointerType = e.pointerType;
    if (!getState().placing || e.pointerType !== 'mouse') return;
    const r = container.getBoundingClientRect();
    const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
    movePlacing([ll.lng, ll.lat]);
  });

  const ghost = el('div', 'pin pin-ghost');
  const label = el('span', 'pin-label');
  const hint = el('span', 'ghost-hint');
  ghost.append(label, hint);
  shieldFromMap(ghost);
  let marker: maplibregl.Marker | undefined;

  const bar = el('div', 'placing-bar');
  const place = button('Place', 'place-confirm', 'primary');
  const cancel = button('Cancel', 'place-cancel');
  place.addEventListener('click', commitPlacing);
  cancel.addEventListener('click', cancelPlacing);
  bar.append(cancel, place);
  bar.hidden = true;
  app.append(bar);

  makeDraggable({
    map,
    handle: ghost,
    enabled: () => !!getState().placing,
    anchorPoint: () => {
      const r = ghost.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.bottom };
    },
    onPreview: (ll: LngLat) => movePlacing(ll),
    onDrop: (ll: LngLat) => movePlacing(ll),
    onCancel: () => undefined,
  });

  // A click (not a pan: MapLibre applies clickTolerance) either drops the pin (mouse) or moves it (touch).
  map.on('click', (e) => {
    if (!getState().placing) return;
    movePlacing([e.lngLat.lng, e.lngLat.lat]);
    if (pointerType === 'mouse') commitPlacing();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && getState().placing) cancelPlacing();
  });

  const sync = (): void => {
    const p = getState().placing;
    if (p && marker) marker.setLngLat(p.lngLat);
  };
  subscribePlacing(sync);

  let active = false;
  subscribe(() => {
    const p = getState().placing;
    container.classList.toggle('placing', !!p);
    if (p && !active) {
      active = true;
      const m = activeMap();
      const start = sanPath(m, p.parentCursor).length;
      label.textContent = moveLabel(start, p.san);
      const touch = pointerType !== 'mouse';
      hint.textContent = touch ? 'drag or tap the map' : 'click to place';
      ghost.classList.toggle('touch', touch);
      bar.hidden = !touch;
      marker = new maplibregl.Marker({ element: ghost, anchor: 'bottom' }).setLngLat(p.lngLat).addTo(map);
      // Ease out well so there is room around the board.
      map.easeTo({ zoom: Math.max(map.getMinZoom(), map.getZoom() - 2), padding: padding(), duration: 400 });
    } else if (!p && active) {
      active = false;
      bar.hidden = true;
      marker?.remove();
      marker = undefined;
    }
  });
}

import maplibregl from 'maplibre-gl';
import { moveLabel, type LngLat } from '../../../domain';
import type { ChessMapApp } from '../../../application';
import { button, el, shieldFromMap } from '../ui/dom';
import { makeDraggable } from './drag';
import { padding } from './mapView';

/** Carry-to-place: a ghost pin follows the pointer (mouse) or can be dragged / tapped into place (touch). */
export function createPlacing(map: maplibregl.Map, appElement: HTMLElement, app: ChessMapApp): void {
  const container = map.getContainer();
  let pointerType = 'mouse';
  container.addEventListener('pointerdown', (e) => (pointerType = e.pointerType), true);
  container.addEventListener('pointermove', (e) => {
    pointerType = e.pointerType;
    if (!app.session.placing || e.pointerType !== 'mouse') return;
    const r = container.getBoundingClientRect();
    const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
    app.movePlacing([ll.lng, ll.lat]);
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
  place.addEventListener('click', () => app.confirmPlacing());
  cancel.addEventListener('click', () => app.cancelPlacing());
  bar.append(cancel, place);
  bar.hidden = true;
  appElement.append(bar);

  makeDraggable({
    map,
    handle: ghost,
    enabled: () => !!app.session.placing,
    anchorPoint: () => {
      const r = ghost.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.bottom };
    },
    onPreview: (ll: LngLat) => app.movePlacing(ll),
    onDrop: (ll: LngLat) => app.movePlacing(ll),
    onCancel: () => undefined,
  });

  // A click (not a pan: MapLibre applies clickTolerance) either drops the pin (mouse) or moves it (touch).
  map.on('click', (e) => {
    if (!app.session.placing) return;
    app.movePlacing([e.lngLat.lng, e.lngLat.lat]);
    if (pointerType === 'mouse') app.confirmPlacing();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.session.placing) app.cancelPlacing();
  });

  const sync = (): void => {
    const p = app.session.placing;
    if (p && marker) marker.setLngLat(p.lngLat);
  };
  app.subscribePlacing(sync);

  let active = false;
  app.subscribe(() => {
    const p = app.session.placing;
    container.classList.toggle('placing', !!p);
    if (p && !active) {
      active = true;
      const start = app.session.repertoire.sanPath(p.parentCursor).length;
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

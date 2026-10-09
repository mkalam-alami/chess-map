import type { Map as MlMap } from 'maplibre-gl';
import type { LngLat } from '../../../domain';

export interface DragOptions {
  map: MlMap;
  handle: HTMLElement;
  enabled: () => boolean;
  /** Where the marker is anchored on screen (client coords). */
  anchorPoint: () => { x: number; y: number };
  /** Long-press (500ms without moving) arms "move subtree" mode. */
  longPress?: boolean;
  onPreview: (ll: LngLat, subtree: boolean) => void;
  onDrop: (ll: LngLat, subtree: boolean) => void;
  onCancel: () => void;
}

/** Own pointer-based drag so that only `handle` moves the marker. Returns a "did a drag just end?" probe. */
export function makeDraggable(o: DragOptions): () => boolean {
  let justDragged = false;
  o.handle.addEventListener('pointerdown', (e) => {
    if (!o.enabled() || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const rect = o.map.getContainer().getBoundingClientRect();
    const anchor = o.anchorPoint();
    const grab = { x: e.clientX - anchor.x, y: e.clientY - anchor.y };
    const from = { x: e.clientX, y: e.clientY };
    let dragging = false;
    let subtree = e.shiftKey;
    let last: LngLat | null = null;
    const timer = o.longPress
      ? setTimeout(() => {
          if (!dragging) {
            subtree = true;
            o.handle.classList.add('subtree');
          }
        }, 500)
      : undefined;
    o.handle.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent): void => {
      if (!dragging && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 5) return;
      if (!dragging) {
        dragging = true;
        clearTimeout(timer);
        o.handle.classList.add('dragging');
      }
      subtree ||= ev.shiftKey;
      const p = o.map.unproject([ev.clientX - grab.x - rect.left, ev.clientY - grab.y - rect.top]);
      last = [p.lng, p.lat];
      o.onPreview(last, subtree);
    };
    const end = (ev: PointerEvent): void => {
      clearTimeout(timer);
      o.handle.removeEventListener('pointermove', move);
      o.handle.removeEventListener('pointerup', end);
      o.handle.removeEventListener('pointercancel', end);
      o.handle.classList.remove('dragging', 'subtree');
      if (!dragging) return;
      justDragged = true;
      setTimeout(() => (justDragged = false), 0);
      if (ev.type === 'pointercancel' || !last) o.onCancel();
      else o.onDrop(last, subtree || ev.shiftKey);
    };
    o.handle.addEventListener('pointermove', move);
    o.handle.addEventListener('pointerup', end);
    o.handle.addEventListener('pointercancel', end);
  });
  return () => justDragged;
}

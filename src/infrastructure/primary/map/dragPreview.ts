import type { LngLat, NodeId, Repertoire } from '../../../domain';

/** Transient positions while nodes are being dragged (not yet committed to the application). One instance is shared by the map views. */
export interface DragPreview {
  readonly overrides: ReadonlyMap<NodeId, LngLat>;
  /** Called whenever the overrides change. */
  onChange: (f: () => void) => void;
  /** Live preview of moving `id` to `ll`, optionally with all its descendants. */
  previewMove: (map: Repertoire, id: NodeId, ll: LngLat, subtree: boolean) => void;
  clear: () => void;
}

export function createDragPreview(): DragPreview {
  const overrides = new Map<NodeId, LngLat>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const f of listeners) f();
  };
  return {
    overrides,
    onChange: (f) => void listeners.add(f),
    previewMove(map, id, ll, subtree) {
      overrides.clear();
      const from = map.node(id).lngLat;
      overrides.set(id, ll);
      if (subtree) {
        for (const d of map.branchIds(id)) {
          if (d === id) continue;
          const n = map.node(d).lngLat;
          overrides.set(d, [n[0] + ll[0] - from[0], n[1] + ll[1] - from[1]]);
        }
      }
      notify();
    },
    clear() {
      overrides.clear();
      notify();
    },
  };
}

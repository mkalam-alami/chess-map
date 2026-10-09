import type { LngLat, NodeId, Repertoire } from '../domain';

/** Transient positions while a node is being dragged (not yet committed to the store). */
export const overrides = new Map<NodeId, LngLat>();
const listeners = new Set<() => void>();
const notify = (): void => {
  for (const f of listeners) f();
};

export const onOverride = (f: () => void): void => {
  listeners.add(f);
};

/** Live preview of moving `id` to `ll`, optionally with all its descendants. */
export function previewMove(map: Repertoire, id: NodeId, ll: LngLat, subtree: boolean): void {
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
}

export function clearPreview(): void {
  overrides.clear();
  notify();
}

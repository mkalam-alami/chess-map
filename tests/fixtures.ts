import { addChild, appendPly, createMap, setPinned } from '../src/model/tree';
import { getNode, type ChessMap, type LngLat, type MapNode, type NodeId } from '../src/model/types';

export const O: LngLat = [0, 0];

/** root -> sans[0] -> sans[1] ... as 1-ply markers. `ids[0]` is the root; marker i sits at [i, i]. */
export function lineOf(sans: string[], map: ChessMap = createMap('t', 'white', O)): { map: ChessMap; ids: NodeId[] } {
  const ids: NodeId[] = [map.rootId];
  sans.forEach((san, i) => {
    const r = addChild(map, ids[i] as NodeId, san, [i + 1, i + 1]);
    map = r.map;
    ids.push(r.nodeId);
  });
  return { map, ids };
}

/** root -> one pinned segment holding all of `sans`. */
export function pinnedOf(sans: string[]): { map: ChessMap; id: NodeId } {
  const { map: m0, ids } = lineOf(sans.slice(0, 1));
  const id = ids[1] as NodeId;
  let map = setPinned(m0, id, true);
  for (const s of sans.slice(1)) map = appendPly(map, id, s);
  return { map, id };
}

/** Nested moves: `{ e4: { e5: {}, c5: {} }, d4: {} }`. Siblings keep their order (the last one is lastChild). */
export interface Spec { [san: string]: Spec }

/**
 * Builds a map of 1-ply markers from a spec. `id('e4 c5')` returns the node reached by that line
 * (`id('')` is the root). Markers get distinct positions [n, n / 2] in creation order.
 */
export function treeOf(spec: Spec, map: ChessMap = createMap('t', 'white', O)): { map: ChessMap; id: (line: string) => NodeId } {
  const ids = new Map<string, NodeId>([['', map.rootId]]);
  let n = 0;
  const walk = (s: Spec, parent: string): void => {
    for (const [san, sub] of Object.entries(s)) {
      n++;
      const r = addChild(map, ids.get(parent) as NodeId, san, [n, n / 2]);
      map = r.map;
      const line = parent ? `${parent} ${san}` : san;
      ids.set(line, r.nodeId);
      walk(sub, line);
    }
  };
  walk(spec, '');
  return {
    map,
    id: (line) => {
      const found = ids.get(line);
      if (!found) throw new Error(`No node for "${line}"`);
      return found;
    },
  };
}

/** The i-th child node of `id`. */
export const childOf = (map: ChessMap, id: NodeId, i = 0): MapNode => getNode(map, getNode(map, id).children[i] as NodeId);

/** Replaces fields of one node, bypassing the model's rules (for hand-made edge cases). */
export const patchNode = (map: ChessMap, id: NodeId, patch: Partial<MapNode>): ChessMap =>
  ({ ...map, nodes: { ...map.nodes, [id]: { ...getNode(map, id), ...patch } } });

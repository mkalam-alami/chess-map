// Private tree surgery on `ChessMapData`. Only Repertoire (and the cursor / scale helpers) use it:
// nothing here is part of the domain's public API.
import { newId } from '../id';
import type { LngLat } from '../geo';
import type { ChessMapData, Cursor, MapNodeData, NodeId, Orientation } from './types';

export function getNode(map: ChessMapData, id: NodeId): MapNodeData {
  const node = map.nodes[id];
  if (!node) throw new Error(`Unknown node ${id}`);
  return node;
}

/** Lowest valid cursor ply on a node: 0 for the root (start position), 1 elsewhere. */
export const minPly = (node: MapNodeData): number => (node.parentId === null ? 0 : 1);

const put = (map: ChessMapData, ...nodes: MapNodeData[]): ChessMapData => {
  const out = { ...map.nodes };
  for (const n of nodes) out[n.id] = n;
  return { ...map, nodes: out };
};

const update = (map: ChessMapData, id: NodeId, patch: Partial<MapNodeData>): ChessMapData =>
  put(map, { ...getNode(map, id), ...patch });

/** Sets an optional field, or removes it when `value` is undefined (absent means default). */
function withOptional<K extends 'note' | 'place' | 'sizeDelta'>(map: ChessMapData, id: NodeId, key: K, value: MapNodeData[K] | undefined): ChessMapData {
  const { [key]: _old, ...rest } = getNode(map, id);
  return put(map, (value === undefined ? rest : { ...rest, [key]: value }) as MapNodeData);
}

export function createMapData(name: string, orientation: Orientation, lngLat: LngLat): ChessMapData {
  const root: MapNodeData = { id: newId(), parentId: null, plies: [], pinned: false, lngLat, children: [] };
  return { id: newId(), name, orientation, rootId: root.id, nodes: { [root.id]: root } };
}

/** Adds a 1-ply child at the end of `parentId`. Returns the existing child if one starts with `san`. */
export function addChild(map: ChessMapData, parentId: NodeId, san: string, lngLat: LngLat): { map: ChessMapData; nodeId: NodeId } {
  const parent = getNode(map, parentId);
  const existing = parent.children.find((id) => getNode(map, id).plies[0] === san);
  if (existing) return { map, nodeId: existing };
  const child: MapNodeData = { id: newId(), parentId, plies: [san], pinned: false, lngLat, children: [] };
  return { map: put(map, { ...parent, children: [...parent.children, child.id], lastChild: child.id }, child), nodeId: child.id };
}

/** Pinned nodes only, and only while they are a leaf (otherwise use branchAt). */
export function appendPly(map: ChessMapData, nodeId: NodeId, san: string): ChessMapData {
  const node = getNode(map, nodeId);
  if (!node.pinned) throw new Error('appendPly: node is not pinned');
  if (node.children.length) throw new Error('appendPly: node has children');
  return update(map, nodeId, { plies: [...node.plies, san] });
}

/** Undo rules: leaf nodes only, and a non-root node keeps at least 1 ply (use deleteSubtree to remove it). */
export function canUndoLastPly(map: ChessMapData, nodeId: NodeId): boolean {
  const node = getNode(map, nodeId);
  return node.children.length === 0 && node.plies.length > minPly(node);
}

/** Drops the last ply if allowed (see canUndoLastPly), otherwise returns the map unchanged. */
export function undoLastPly(map: ChessMapData, nodeId: NodeId): ChessMapData {
  if (!canUndoLastPly(map, nodeId)) return map;
  return update(map, nodeId, { plies: getNode(map, nodeId).plies.slice(0, -1) });
}

/**
 * Splits a segment at `atPly` (1..len-1). The head keeps plies[0..atPly], the
 * tail (new, pinned, same lngLat) gets the rest plus all old children.
 */
export function splitSegment(map: ChessMapData, nodeId: NodeId, atPly: number): { map: ChessMapData; tailId: NodeId } {
  const node = getNode(map, nodeId);
  if (atPly < 1 || atPly >= node.plies.length) throw new Error(`splitSegment: bad ply ${atPly}`);
  const tail: MapNodeData = {
    id: newId(), parentId: nodeId, plies: node.plies.slice(atPly), pinned: true, lngLat: node.lngLat,
    children: node.children,
    ...(node.lastChild ? { lastChild: node.lastChild } : {}),
    ...(node.place ? { place: node.place } : {}),
  };
  const head: MapNodeData = { ...node, plies: node.plies.slice(0, atPly), children: [tail.id], lastChild: tail.id };
  const moved = node.children.map((id) => ({ ...getNode(map, id), parentId: tail.id }));
  return { map: put(map, head, tail, ...moved), tailId: tail.id };
}

/** Plays `san` at the cursor, splitting a segment mid-way if needed. Existing moves are reused. */
export function branchAt(map: ChessMapData, cursor: Cursor, san: string, lngLat: LngLat): { map: ChessMapData; cursor: Cursor } {
  const node = getNode(map, cursor.nodeId);
  if (cursor.ply > node.plies.length || cursor.ply < minPly(node)) throw new Error('branchAt: bad cursor');
  if (cursor.ply < node.plies.length) {
    if (node.plies[cursor.ply] === san) return { map, cursor: { nodeId: node.id, ply: cursor.ply + 1 } };
    map = splitSegment(map, node.id, cursor.ply).map;
  }
  const r = addChild(map, node.id, san, lngLat);
  return { map: r.map, cursor: { nodeId: r.nodeId, ply: 1 } };
}

export function subtreeIds(map: ChessMapData, nodeId: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack = [nodeId];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    out.push(id);
    stack.push(...getNode(map, id).children);
  }
  return out;
}

export function deleteSubtree(map: ChessMapData, nodeId: NodeId): ChessMapData {
  const node = getNode(map, nodeId);
  if (node.parentId === null) throw new Error('Cannot delete the root');
  const nodes = { ...map.nodes };
  for (const id of subtreeIds(map, nodeId)) delete nodes[id];
  const { lastChild, ...parent } = getNode(map, node.parentId);
  nodes[parent.id] = {
    ...parent,
    children: parent.children.filter((id) => id !== nodeId),
    ...(lastChild && lastChild !== nodeId ? { lastChild } : {}),
  };
  return { ...map, nodes };
}

export function moveNode(map: ChessMapData, nodeId: NodeId, lngLat: LngLat, opts: { withSubtree?: boolean } = {}): ChessMapData {
  if (!opts.withSubtree) return update(map, nodeId, { lngLat });
  const from = getNode(map, nodeId).lngLat;
  const dLng = lngLat[0] - from[0];
  const dLat = lngLat[1] - from[1];
  const moved = subtreeIds(map, nodeId).map((id) => {
    const n = getNode(map, id);
    return { ...n, lngLat: id === nodeId ? lngLat : ([n.lngLat[0] + dLng, n.lngLat[1] + dLat] as LngLat) };
  });
  return put(map, ...moved);
}

/** Empty/blank note removes it. */
export const setNote = (map: ChessMapData, nodeId: NodeId, note: string | undefined): ChessMapData =>
  withOptional(map, nodeId, 'note', note?.trim() ? note : undefined);

export const setPlace = (map: ChessMapData, nodeId: NodeId, place: MapNodeData['place']): ChessMapData => withOptional(map, nodeId, 'place', place);

/** Board size relative to the parent, in log2 steps of 0.25. 0 removes the field (inherit). */
export const setSizeDelta = (map: ChessMapData, nodeId: NodeId, delta: number): ChessMapData =>
  withOptional(map, nodeId, 'sizeDelta', Math.round(delta * 4) / 4 || undefined);

export const setPinned = (map: ChessMapData, nodeId: NodeId, pinned: boolean): ChessMapData => update(map, nodeId, { pinned });

/** Node ids from the root down to `nodeId`. */
export function pathTo(map: ChessMapData, nodeId: NodeId): NodeId[] {
  const out: NodeId[] = [];
  for (let id: NodeId | null = nodeId; id !== null; id = getNode(map, id).parentId) out.unshift(id);
  return out;
}

/** All plies from the root up to the cursor. */
export function sanPath(map: ChessMapData, cursor: Cursor): string[] {
  let node = getNode(map, cursor.nodeId);
  let out = node.plies.slice(0, cursor.ply);
  while (node.parentId !== null) {
    node = getNode(map, node.parentId);
    out = [...node.plies, ...out];
  }
  return out;
}

/** Number of nodes (markers) between `from` and every node of the tree, walking up and down: parent and children are 1 away. */
export function nodeDistances(map: ChessMapData, from: NodeId): Map<NodeId, number> {
  const out = new Map<NodeId, number>([[from, 0]]);
  const queue: NodeId[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i] as NodeId;
    const node = getNode(map, id);
    const d = (out.get(id) as number) + 1;
    for (const next of node.parentId === null ? node.children : [node.parentId, ...node.children]) {
      if (out.has(next)) continue;
      out.set(next, d);
      queue.push(next);
    }
  }
  return out;
}

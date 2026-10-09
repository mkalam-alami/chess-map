import { fenAt } from '../chess/replay';
import { newId } from './id';
import { getNode, type ChessMap, type Cursor, type LngLat, type Library, type MapNode, type NodeId } from './types';

const put = (map: ChessMap, ...nodes: MapNode[]): ChessMap => {
  const out = { ...map.nodes };
  for (const n of nodes) out[n.id] = n;
  return { ...map, nodes: out };
};

const update = (map: ChessMap, id: NodeId, patch: Partial<MapNode>): ChessMap =>
  put(map, { ...getNode(map, id), ...patch });

export function createMap(name: string, orientation: 'white' | 'black', lngLat: LngLat): ChessMap {
  const root: MapNode = { id: newId(), parentId: null, plies: [], pinned: false, lngLat, children: [] };
  return { id: newId(), name, orientation, rootId: root.id, nodes: { [root.id]: root } };
}

export const createLibrary = (map: ChessMap): Library => ({ version: 1, maps: { [map.id]: map }, activeMapId: map.id });

/** Adds a 1-ply child at the end of `parentId`. Returns the existing child if one starts with `san`. */
export function addChild(map: ChessMap, parentId: NodeId, san: string, lngLat: LngLat): { map: ChessMap; nodeId: NodeId } {
  const parent = getNode(map, parentId);
  const existing = parent.children.find((id) => getNode(map, id).plies[0] === san);
  if (existing) return { map, nodeId: existing };
  const child: MapNode = { id: newId(), parentId, plies: [san], pinned: false, lngLat, children: [] };
  return { map: put(map, { ...parent, children: [...parent.children, child.id], lastChild: child.id }, child), nodeId: child.id };
}

/** Pinned nodes only, and only while they are a leaf (otherwise use branchAt). */
export function appendPly(map: ChessMap, nodeId: NodeId, san: string): ChessMap {
  const node = getNode(map, nodeId);
  if (!node.pinned) throw new Error('appendPly: node is not pinned');
  if (node.children.length) throw new Error('appendPly: node has children');
  return update(map, nodeId, { plies: [...node.plies, san] });
}

/** Undo rules: leaf nodes only, and a non-root node keeps at least 1 ply (use deleteSubtree to remove it). */
export function canUndoLastPly(map: ChessMap, nodeId: NodeId): boolean {
  const node = getNode(map, nodeId);
  return node.children.length === 0 && node.plies.length > (node.parentId === null ? 0 : 1);
}

/** Drops the last ply if allowed (see canUndoLastPly), otherwise returns the map unchanged. */
export function undoLastPly(map: ChessMap, nodeId: NodeId): ChessMap {
  if (!canUndoLastPly(map, nodeId)) return map;
  return update(map, nodeId, { plies: getNode(map, nodeId).plies.slice(0, -1) });
}

/**
 * Splits a segment at `atPly` (1..len-1). The head keeps plies[0..atPly], the
 * tail (new, pinned, same lngLat) gets the rest plus all old children.
 */
export function splitSegment(map: ChessMap, nodeId: NodeId, atPly: number): { map: ChessMap; tailId: NodeId } {
  const node = getNode(map, nodeId);
  if (atPly < 1 || atPly >= node.plies.length) throw new Error(`splitSegment: bad ply ${atPly}`);
  const tail: MapNode = {
    id: newId(), parentId: nodeId, plies: node.plies.slice(atPly), pinned: true, lngLat: node.lngLat,
    children: node.children,
    ...(node.lastChild ? { lastChild: node.lastChild } : {}),
    ...(node.place ? { place: node.place } : {}),
  };
  const head: MapNode = { ...node, plies: node.plies.slice(0, atPly), children: [tail.id], lastChild: tail.id };
  const moved = node.children.map((id) => ({ ...getNode(map, id), parentId: tail.id }));
  return { map: put(map, head, tail, ...moved), tailId: tail.id };
}

/** Plays `san` at the cursor, splitting a segment mid-way if needed. Existing moves are reused. */
export function branchAt(map: ChessMap, cursor: Cursor, san: string, lngLat: LngLat): { map: ChessMap; cursor: Cursor } {
  const node = getNode(map, cursor.nodeId);
  if (cursor.ply > node.plies.length || (cursor.ply < 1 && node.parentId !== null)) throw new Error('branchAt: bad cursor');
  if (cursor.ply < node.plies.length) {
    if (node.plies[cursor.ply] === san) return { map, cursor: { nodeId: node.id, ply: cursor.ply + 1 } };
    map = splitSegment(map, node.id, cursor.ply).map;
  }
  const r = addChild(map, node.id, san, lngLat);
  return { map: r.map, cursor: { nodeId: r.nodeId, ply: 1 } };
}

export function subtreeIds(map: ChessMap, nodeId: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack = [nodeId];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    out.push(id);
    stack.push(...getNode(map, id).children);
  }
  return out;
}

export const subtreeSize = (map: ChessMap, nodeId: NodeId): number => subtreeIds(map, nodeId).length;

export function deleteSubtree(map: ChessMap, nodeId: NodeId): { map: ChessMap; removed: number } {
  const node = getNode(map, nodeId);
  if (node.parentId === null) throw new Error('Cannot delete the root');
  const ids = subtreeIds(map, nodeId);
  const nodes = { ...map.nodes };
  for (const id of ids) delete nodes[id];
  const { lastChild, ...parent } = getNode(map, node.parentId);
  nodes[parent.id] = {
    ...parent,
    children: parent.children.filter((id) => id !== nodeId),
    ...(lastChild && lastChild !== nodeId ? { lastChild } : {}),
  };
  return { map: { ...map, nodes }, removed: ids.length };
}

export function moveNode(map: ChessMap, nodeId: NodeId, lngLat: LngLat, opts: { withSubtree?: boolean } = {}): ChessMap {
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
export function setNote(map: ChessMap, nodeId: NodeId, note: string | undefined): ChessMap {
  const { note: _old, ...rest } = getNode(map, nodeId);
  return put(map, note?.trim() ? { ...rest, note } : rest);
}

export function setPlace(map: ChessMap, nodeId: NodeId, place: MapNode['place']): ChessMap {
  const { place: _old, ...rest } = getNode(map, nodeId);
  return put(map, place ? { ...rest, place } : rest);
}

/** Board size relative to the parent, in log2 steps of 0.25. 0 removes the field (inherit). */
export function setSizeDelta(map: ChessMap, nodeId: NodeId, delta: number): ChessMap {
  const { sizeDelta: _old, ...rest } = getNode(map, nodeId);
  const d = Math.round(delta * 4) / 4;
  return put(map, d ? { ...rest, sizeDelta: d } : rest);
}

export const setPinned = (map: ChessMap, nodeId: NodeId, pinned: boolean): ChessMap => update(map, nodeId, { pinned });

export function setLastChild(map: ChessMap, nodeId: NodeId, childId: NodeId): ChessMap {
  if (!getNode(map, nodeId).children.includes(childId)) throw new Error('setLastChild: not a child');
  return update(map, nodeId, { lastChild: childId });
}

/** Node ids from the root down to `nodeId`. */
export function pathTo(map: ChessMap, nodeId: NodeId): NodeId[] {
  const out: NodeId[] = [];
  for (let id: NodeId | null = nodeId; id !== null; id = getNode(map, id).parentId) out.unshift(id);
  return out;
}

const posKey = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');

/** Other cursors in the map reaching the same position (FEN fields 1-4). */
export function findTranspositions(map: ChessMap, cursor: Cursor): Cursor[] {
  const target = posKey(fenAt(map, cursor));
  const out: Cursor[] = [];
  for (const node of Object.values(map.nodes)) {
    for (let ply = node.parentId === null ? 0 : 1; ply <= node.plies.length; ply++) {
      if (node.id === cursor.nodeId && ply === cursor.ply) continue;
      if (posKey(fenAt(map, { nodeId: node.id, ply })) === target) out.push({ nodeId: node.id, ply });
    }
  }
  return out;
}

/** Number of nodes (markers) between `from` and every node of the tree, walking up and down: parent and children are 1 away. */
export function nodeDistances(map: ChessMap, from: NodeId): Map<NodeId, number> {
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

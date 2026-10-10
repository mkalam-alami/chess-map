// Private tree surgery on `ChessMapData`. Only Repertoire (and the cursor / scale helpers) use it:
// nothing here is part of the domain's public API.
import { newId } from '../id';
import type { LngLat } from '../geo';
import type { BoardShape, ChessMapData, Cursor, MapNodeData, NodeId, Orientation } from './types';

export function getNode(map: ChessMapData, id: NodeId): MapNodeData {
  const node = map.nodes[id];
  if (!node) throw new Error(`Unknown node ${id}`);
  return node;
}

/** Lowest valid cursor move on a node: 0 for the root (start position), 1 elsewhere. */
export const minPlayed = (node: MapNodeData): number => (node.parentId === null ? 0 : 1);

const put = (map: ChessMapData, ...nodes: MapNodeData[]): ChessMapData => {
  const out = { ...map.nodes };
  for (const n of nodes) out[n.id] = n;
  return { ...map, nodes: out };
};

const update = (map: ChessMapData, id: NodeId, patch: Partial<MapNodeData>): ChessMapData =>
  put(map, { ...getNode(map, id), ...patch });

/** Sets an optional field, or removes it when `value` is undefined (absent means default). */
function withOptional<K extends 'note' | 'noteShown' | 'place' | 'shapes' | 'sizeDelta'>(map: ChessMapData, id: NodeId, key: K, value: MapNodeData[K] | undefined): ChessMapData {
  const { [key]: _old, ...rest } = getNode(map, id);
  return put(map, (value === undefined ? rest : { ...rest, [key]: value }) as MapNodeData);
}

export function createMapData(name: string, orientation: Orientation, lngLat: LngLat): ChessMapData {
  const root: MapNodeData = { id: newId(), parentId: null, moves: [], pinned: false, lngLat, children: [] };
  return { id: newId(), name, orientation, rootId: root.id, nodes: { [root.id]: root } };
}

/** Adds a 1-move child at the end of `parentId`. Returns the existing child if one starts with `san`. */
export function addChild(map: ChessMapData, parentId: NodeId, san: string, lngLat: LngLat): { map: ChessMapData; nodeId: NodeId } {
  const parent = getNode(map, parentId);
  const existing = parent.children.find((id) => getNode(map, id).moves[0] === san);
  if (existing) return { map, nodeId: existing };
  const child: MapNodeData = { id: newId(), parentId, moves: [san], pinned: false, lngLat, children: [] };
  return { map: put(map, { ...parent, children: [...parent.children, child.id], lastChild: child.id }, child), nodeId: child.id };
}

/** Pinned nodes only, and only while they are a leaf (otherwise use branchAt). */
export function appendMove(map: ChessMapData, nodeId: NodeId, san: string): ChessMapData {
  const node = getNode(map, nodeId);
  if (!node.pinned) throw new Error('appendMove: node is not pinned');
  if (node.children.length) throw new Error('appendMove: node has children');
  return update(map, nodeId, { moves: [...node.moves, san] });
}

/** Undo rules: leaf nodes only, and a non-root node keeps at least 1 move (use deleteSubtree to remove it). */
export function canUndoLastMove(map: ChessMapData, nodeId: NodeId): boolean {
  const node = getNode(map, nodeId);
  return node.children.length === 0 && node.moves.length > minPlayed(node);
}

/** Drops the last move if allowed (see canUndoLastMove), otherwise returns the map unchanged. */
export function undoLastMove(map: ChessMapData, nodeId: NodeId): ChessMapData {
  if (!canUndoLastMove(map, nodeId)) return map;
  const node = getNode(map, nodeId);
  const dropped = setShapes(map, nodeId, node.moves.length, []); // the annotations of the position that disappears go with it
  return update(dropped, nodeId, { moves: node.moves.slice(0, -1) });
}

/** Replaces the annotations of one position of a node (an empty list removes them, and the field when none remain). */
export function setShapes(map: ChessMapData, nodeId: NodeId, played: number, shapes: BoardShape[]): ChessMapData {
  const { [played]: _old, ...others } = getNode(map, nodeId).shapes ?? {};
  const next = shapes.length ? { ...others, [played]: shapes } : others;
  return withOptional(map, nodeId, 'shapes', Object.keys(next).length ? next : undefined);
}

/** Splits the annotations at `keep` moves: the tail's positions are renumbered from its own first move. */
function splitShapes(shapes: MapNodeData['shapes'], keep: number): { head?: Record<number, BoardShape[]>; tail?: Record<number, BoardShape[]> } {
  const head: Record<number, BoardShape[]> = {};
  const tail: Record<number, BoardShape[]> = {};
  for (const [key, list] of Object.entries(shapes ?? {})) {
    const played = Number(key);
    if (played <= keep) head[played] = list;
    else tail[played - keep] = list;
  }
  return { ...(Object.keys(head).length ? { head } : {}), ...(Object.keys(tail).length ? { tail } : {}) };
}

/**
 * Splits a segment at `keep` (1..len-1). The head keeps moves[0..keep], the
 * tail (new, pinned, same lngLat) gets the rest plus all old children.
 */
export function splitSegment(map: ChessMapData, nodeId: NodeId, keep: number): { map: ChessMapData; tailId: NodeId } {
  const node = getNode(map, nodeId);
  if (keep < 1 || keep >= node.moves.length) throw new Error(`splitSegment: bad split point ${keep}`);
  const split = splitShapes(node.shapes, keep);
  const tail: MapNodeData = {
    id: newId(), parentId: nodeId, moves: node.moves.slice(keep), pinned: true, lngLat: node.lngLat,
    children: node.children,
    ...(split.tail ? { shapes: split.tail } : {}),
    ...(node.lastChild ? { lastChild: node.lastChild } : {}),
    ...(node.place ? { place: node.place } : {}),
  };
  const { shapes: _all, ...rest } = node;
  const head: MapNodeData = { ...rest, moves: node.moves.slice(0, keep), children: [tail.id], lastChild: tail.id, ...(split.head ? { shapes: split.head } : {}) };
  const moved = node.children.map((id) => ({ ...getNode(map, id), parentId: tail.id }));
  return { map: put(map, head, tail, ...moved), tailId: tail.id };
}

/** Plays `san` at the cursor, splitting a segment mid-way if needed. Existing moves are reused. */
export function branchAt(map: ChessMapData, cursor: Cursor, san: string, lngLat: LngLat): { map: ChessMapData; cursor: Cursor } {
  const node = getNode(map, cursor.nodeId);
  if (cursor.played > node.moves.length || cursor.played < minPlayed(node)) throw new Error('branchAt: bad cursor');
  if (cursor.played < node.moves.length) {
    if (node.moves[cursor.played] === san) return { map, cursor: { nodeId: node.id, played: cursor.played + 1 } };
    map = splitSegment(map, node.id, cursor.played).map;
  }
  const r = addChild(map, node.id, san, lngLat);
  return { map: r.map, cursor: { nodeId: r.nodeId, played: 1 } };
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

/** Empty/blank note removes it, and with it the "shown on the marker" flag. */
export const setNote = (map: ChessMapData, nodeId: NodeId, note: string | undefined): ChessMapData => {
  const next = withOptional(map, nodeId, 'note', note?.trim() ? note : undefined);
  return note?.trim() ? next : withOptional(next, nodeId, 'noteShown', undefined);
};

/** Keeps the note visible under the marker (false removes the field). Needs a note. */
export const setNoteShown = (map: ChessMapData, nodeId: NodeId, shown: boolean): ChessMapData =>
  withOptional(map, nodeId, 'noteShown', shown && getNode(map, nodeId).note ? true : undefined);

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

/** All moves from the root up to the cursor. */
export function sanPath(map: ChessMapData, cursor: Cursor): string[] {
  let node = getNode(map, cursor.nodeId);
  let out = node.moves.slice(0, cursor.played);
  while (node.parentId !== null) {
    node = getNode(map, node.parentId);
    out = [...node.moves, ...out];
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

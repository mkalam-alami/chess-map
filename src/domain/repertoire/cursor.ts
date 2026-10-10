// Cursor navigation rules on a map's data (see the `Cursor` convention in types.ts). Used through Repertoire.

import { getNode, minPly } from './tree';
import type { ChessMapData, Cursor, NodeId } from './types';

export const rootCursor = (map: ChessMapData): Cursor => ({ nodeId: map.rootId, ply: 0 });

/** Cursor after the full segment of a node. */
export const cursorEnd = (map: ChessMapData, nodeId: NodeId): Cursor => ({ nodeId, ply: getNode(map, nodeId).plies.length });

/** Same node and ply. */
export const sameCursor = (a: Cursor, b: Cursor): boolean => a.nodeId === b.nodeId && a.ply === b.ply;

/** One ply back; null at the start position. */
export function cursorBack(map: ChessMapData, c: Cursor): Cursor | null {
  const node = getNode(map, c.nodeId);
  if (c.ply > minPly(node)) return { nodeId: c.nodeId, ply: c.ply - 1 };
  return node.parentId === null ? null : cursorEnd(map, node.parentId);
}

/** One ply forward: within the segment, else lastChild or only child; otherwise null. */
export function cursorForward(map: ChessMapData, c: Cursor): Cursor | null {
  const node = getNode(map, c.nodeId);
  if (c.ply < node.plies.length) return { nodeId: c.nodeId, ply: c.ply + 1 };
  const next =
    node.lastChild && node.children.includes(node.lastChild)
      ? node.lastChild
      : node.children.length === 1
        ? node.children[0]
        : undefined;
  return next === undefined ? null : { nodeId: next, ply: 1 };
}

/** Where playing `san` at `c` leads within the existing tree (next ply of the segment, or a child); null if it is a new move. */
export function nextCursor(map: ChessMapData, c: Cursor, san: string): Cursor | null {
  const node = getNode(map, c.nodeId);
  if (c.ply < node.plies.length) return node.plies[c.ply] === san ? { nodeId: node.id, ply: c.ply + 1 } : null;
  const child = node.children.find((id) => getNode(map, id).plies[0] === san);
  return child === undefined ? null : { nodeId: child, ply: 1 };
}

/** One cursor per ply of the line leading to `c` (parallel to sanPath). */
export function lineCursors(map: ChessMapData, c: Cursor): Cursor[] {
  const out: Cursor[] = [];
  for (let id: NodeId | null = c.nodeId; id !== null; id = getNode(map, id).parentId) {
    const upto = id === c.nodeId ? c.ply : getNode(map, id).plies.length;
    const own: Cursor[] = [];
    for (let ply = 1; ply <= upto; ply++) own.push({ nodeId: id, ply });
    out.unshift(...own);
  }
  return out;
}

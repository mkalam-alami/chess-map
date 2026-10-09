import { getNode, type ChessMap, type Cursor, type NodeId } from './types';

export const rootCursor = (map: ChessMap): Cursor => ({ nodeId: map.rootId, ply: 0 });

/** Cursor after the full segment of a node. */
export const cursorEnd = (map: ChessMap, nodeId: NodeId): Cursor => ({ nodeId, ply: getNode(map, nodeId).plies.length });

export const sameCursor = (a: Cursor, b: Cursor): boolean => a.nodeId === b.nodeId && a.ply === b.ply;

/** One ply back; null at the start position. */
export function cursorBack(map: ChessMap, c: Cursor): Cursor | null {
  const node = getNode(map, c.nodeId);
  const floor = node.parentId === null ? 0 : 1;
  if (c.ply > floor) return { nodeId: c.nodeId, ply: c.ply - 1 };
  return node.parentId === null ? null : cursorEnd(map, node.parentId);
}

/** One ply forward: within the segment, else lastChild or only child; otherwise null. */
export function cursorForward(map: ChessMap, c: Cursor): Cursor | null {
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

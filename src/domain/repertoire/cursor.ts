// Cursor navigation rules on a map's data (see the `Cursor` convention in types.ts). Used through Repertoire.

import { getNode, minPlayed } from './tree';
import type { ChessMapData, Cursor, NodeId } from './types';

export const rootCursor = (map: ChessMapData): Cursor => ({ nodeId: map.rootId, played: 0 });

/** Cursor after the full segment of a node. */
export const cursorEnd = (map: ChessMapData, nodeId: NodeId): Cursor => ({ nodeId, played: getNode(map, nodeId).moves.length });

/** Same node and same number of moves played. */
export const sameCursor = (a: Cursor, b: Cursor): boolean => a.nodeId === b.nodeId && a.played === b.played;

/** One move back; null at the start position. */
export function cursorBack(map: ChessMapData, c: Cursor): Cursor | null {
  const node = getNode(map, c.nodeId);
  if (c.played > minPlayed(node)) return { nodeId: c.nodeId, played: c.played - 1 };
  return node.parentId === null ? null : cursorEnd(map, node.parentId);
}

/** One move forward: within the segment, else lastChild or only child; otherwise null. */
export function cursorForward(map: ChessMapData, c: Cursor): Cursor | null {
  const node = getNode(map, c.nodeId);
  if (c.played < node.moves.length) return { nodeId: c.nodeId, played: c.played + 1 };
  const next =
    node.lastChild && node.children.includes(node.lastChild)
      ? node.lastChild
      : node.children.length === 1
        ? node.children[0]
        : undefined;
  return next === undefined ? null : { nodeId: next, played: 1 };
}

/** Where playing `san` at `c` leads within the existing tree (next move of the segment, or a child); null if it is a new move. */
export function nextCursor(map: ChessMapData, c: Cursor, san: string): Cursor | null {
  const node = getNode(map, c.nodeId);
  if (c.played < node.moves.length) return node.moves[c.played] === san ? { nodeId: node.id, played: c.played + 1 } : null;
  const child = node.children.find((id) => getNode(map, id).moves[0] === san);
  return child === undefined ? null : { nodeId: child, played: 1 };
}

/** One cursor per move of the line leading to `c` (parallel to sanPath). */
export function lineCursors(map: ChessMapData, c: Cursor): Cursor[] {
  const out: Cursor[] = [];
  for (let id: NodeId | null = c.nodeId; id !== null; id = getNode(map, id).parentId) {
    const upto = id === c.nodeId ? c.played : getNode(map, id).moves.length;
    const own: Cursor[] = [];
    for (let played = 1; played <= upto; played++) own.push({ nodeId: id, played });
    out.unshift(...own);
  }
  return out;
}

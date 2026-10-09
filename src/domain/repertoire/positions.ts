import { Chess } from 'chess.js';
import { START_FEN } from '../chess/rules';
import { getNode } from './tree';
import type { ChessMapData, Cursor, MapNodeData } from './types';

// FEN after each ply of a node (index 0 = before its first ply), cached per
// node object. Nodes are immutable and an ancestor's plies never change
// without descendants being replaced too (splitting re-parents children).
const fenCache = new WeakMap<MapNodeData, string[]>();

const lastOf = (a: string[]): string => a[a.length - 1] as string;

function fensOf(map: ChessMapData, node: MapNodeData): string[] {
  const cached = fenCache.get(node);
  if (cached) return cached;
  const start = node.parentId === null ? START_FEN : lastOf(fensOf(map, getNode(map, node.parentId)));
  const fens = [start];
  const chess = new Chess(start);
  for (const san of node.plies) {
    chess.move(san);
    fens.push(chess.fen());
  }
  fenCache.set(node, fens);
  return fens;
}

export function fenAt(map: ChessMapData, cursor: Cursor): string {
  const fen = fensOf(map, getNode(map, cursor.nodeId))[cursor.ply];
  if (fen === undefined) throw new Error(`Bad cursor ply ${cursor.ply}`);
  return fen;
}

/** FENs from the start position up to the cursor (one more than sanPath), from the per-node cache. */
export function fenPath(map: ChessMapData, cursor: Cursor): string[] {
  let node = getNode(map, cursor.nodeId);
  let out = fensOf(map, node).slice(1, cursor.ply + 1);
  while (node.parentId !== null) {
    node = getNode(map, node.parentId);
    out = [...fensOf(map, node).slice(1), ...out];
  }
  return [START_FEN, ...out];
}

import { Chess, type Square } from 'chess.js';
import { getNode, type ChessMap, type Cursor, type MapNode } from '../model/types';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// FEN after each ply of a node (index 0 = before its first ply), cached per
// node object. Nodes are immutable and an ancestor's plies never change
// without descendants being replaced too (splitting re-parents children).
const fenCache = new WeakMap<MapNode, string[]>();

function lastOf(a: string[]): string {
  return a[a.length - 1] as string;
}

function fensOf(map: ChessMap, node: MapNode): string[] {
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

export function fenAt(map: ChessMap, cursor: Cursor): string {
  const fen = fensOf(map, getNode(map, cursor.nodeId))[cursor.ply];
  if (fen === undefined) throw new Error(`Bad cursor ply ${cursor.ply}`);
  return fen;
}

/** FENs from the start position up to the cursor (one more than sanPath), from the per-node cache. */
export function fenPath(map: ChessMap, cursor: Cursor): string[] {
  let node = getNode(map, cursor.nodeId);
  let out = fensOf(map, node).slice(1, cursor.ply + 1);
  while (node.parentId !== null) {
    node = getNode(map, node.parentId);
    out = [...fensOf(map, node).slice(1), ...out];
  }
  return [START_FEN, ...out];
}

/** FEN fields 1-4 (placement, turn, castling, en passant): identifies a position regardless of move counters. */
export const epd = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');

export const inCheck = (fen: string): boolean => new Chess(fen).inCheck();

/** The mover's colour if moving `from` -> `to` is a pawn promotion, else null. */
export function promotionColor(fen: string, from: string, to: string): 'white' | 'black' | null {
  const piece = new Chess(fen).get(from as Square);
  if (piece?.type !== 'p' || (to[1] !== '1' && to[1] !== '8')) return null;
  return piece.color === 'w' ? 'white' : 'black';
}

/** From / to squares of `san` played at `fen`, for highlighting. */
export function moveSquares(fen: string, san: string): [Square, Square] | undefined {
  try {
    const m = new Chess(fen).move(san);
    return [m.from, m.to];
  } catch {
    return undefined;
  }
}

/** All plies from the root up to the cursor. */
export function sanPath(map: ChessMap, cursor: Cursor): string[] {
  let node = getNode(map, cursor.nodeId);
  let out = node.plies.slice(0, cursor.ply);
  while (node.parentId !== null) {
    node = getNode(map, node.parentId);
    out = [...node.plies, ...out];
  }
  return out;
}

export type MoveInput = { from: string; to: string; promotion?: string } | string;

export function tryMove(fen: string, move: MoveInput): { san: string; fen: string } | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move(move);
    return { san: m.san, fen: chess.fen() };
  } catch {
    return null;
  }
}

/** Legal destinations in chessground's `movable.dests` format. */
export function legalDests(fen: string): Map<Square, Square[]> {
  const dests = new Map<Square, Square[]>();
  for (const m of new Chess(fen).moves({ verbose: true })) {
    const list = dests.get(m.from);
    if (list) list.push(m.to);
    else dests.set(m.from, [m.to]);
  }
  return dests;
}

export function turnColor(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** "1. e4 e5 2. Nf3"; `startPly` is the game ply index of sans[0] (0 = white's first move). */
export function formatLine(sans: string[], startPly = 0): string {
  return sans
    .map((san, i) => {
      const ply = startPly + i;
      if (ply % 2 === 0) return `${ply / 2 + 1}. ${san}`;
      return i === 0 ? `${(ply - 1) / 2 + 1}… ${san}` : san;
    })
    .join(' ');
}

/** "1.e4" for even plyIndexFromStart (0-based), "1…e5" for odd. */
export function moveLabel(plyIndexFromStart: number, san: string): string {
  const n = Math.floor(plyIndexFromStart / 2) + 1;
  return `${n}${plyIndexFromStart % 2 === 0 ? '.' : '…'}${san}`;
}

/** Game ply index of the node's first ply (0 = White's first move). */
export function firstPlyIndex(map: ChessMap, node: MapNode): number {
  if (node.parentId === null) return 0;
  const parent = getNode(map, node.parentId);
  return sanPath(map, { nodeId: parent.id, ply: parent.plies.length }).length;
}

/** `3.Nf3 … (+4)` for multi-ply segments; the start marker is a board icon. */
export function pinLabel(map: ChessMap, node: MapNode): string {
  if (node.parentId === null) return '♟';
  const first = moveLabel(firstPlyIndex(map, node), node.plies[0] as string);
  return node.plies.length > 1 ? `${first} … (+${node.plies.length - 1})` : first;
}

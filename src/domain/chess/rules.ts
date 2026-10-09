import { Chess, type Square } from 'chess.js';

/** Position-level chess rules (chess.js wrapper). Pure: every function takes a FEN or a SAN. */
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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

export type MoveInput = { from: string; to: string; promotion?: string } | string;

/** Plays a move (SAN or from/to) at `fen`; null when illegal. */
export function tryMove(fen: string, move: MoveInput): { san: string; fen: string } | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move(move);
    return { san: m.san, fen: chess.fen() };
  } catch {
    return null;
  }
}

/** Legal destinations in the square -> target squares map board widgets expect. */
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

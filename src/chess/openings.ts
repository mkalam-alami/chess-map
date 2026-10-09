import { Chess } from 'chess.js';
import type { ChessMap, Cursor } from '../model/types';
import { sanPath } from './replay';

// Data: lichess-org/chess-openings (CC0), see scripts/gen-openings.mjs. EPD -> [eco, name].
let table: Record<string, [string, string]> | null = null;
let loading: Promise<void> | null = null;

/** Lazy-loads the opening table (separate chunk). Safe to call repeatedly. */
export function loadOpenings(): Promise<void> {
  loading ??= import('./openings.json').then((m) => {
    table = m.default as unknown as Record<string, [string, string]>;
  });
  return loading;
}

export interface OpeningInfo {
  eco: string;
  name: string;
  /** The current position itself is named. */
  exact: boolean;
  /** Plies played since the deepest named position (0 when exact). */
  pliesSince: number;
}

const epdOf = (chess: Chess): string => chess.fen().split(' ').slice(0, 4).join(' ');

/** Deepest named position along the path to the cursor; null if not loaded or none (e.g. the start). */
export function openingAt(map: ChessMap, cursor: Cursor): OpeningInfo | null {
  if (!table) return null;
  const sans = sanPath(map, cursor);
  const chess = new Chess();
  const epds = [epdOf(chess)];
  for (const san of sans) {
    chess.move(san);
    epds.push(epdOf(chess));
  }
  for (let i = epds.length - 1; i >= 0; i--) {
    const hit = table[epds[i] as string];
    if (hit) return { eco: hit[0], name: hit[1], exact: i === epds.length - 1, pliesSince: epds.length - 1 - i };
  }
  return null;
}

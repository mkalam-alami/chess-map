import type { ChessMap, Cursor } from '../model/types';
import { epd, fenPath } from './replay';

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

/** Deepest named position along the path to the cursor; null if not loaded or none (e.g. the start). */
export function openingAt(map: ChessMap, cursor: Cursor): OpeningInfo | null {
  if (!table) return null;
  const fens = fenPath(map, cursor);
  for (let i = fens.length - 1; i >= 0; i--) {
    const hit = table[epd(fens[i] as string)];
    if (hit) return { eco: hit[0], name: hit[1], exact: i === fens.length - 1, pliesSince: fens.length - 1 - i };
  }
  return null;
}

/** The name, with a `+n` suffix for out-of-book positions. */
export const openingText = (o: OpeningInfo): string => (o.exact ? o.name : `${o.name} +${o.pliesSince}`);

import { openingAt as lookupOpening, type Cursor, type OpeningInfo, type Repertoire } from '../domain';

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

/** Deepest named position along the path to the cursor; null if not loaded or none (e.g. the start). */
export function openingAt(rep: Repertoire, cursor: Cursor): OpeningInfo | null {
  if (!table) return null;
  const t = table;
  return lookupOpening(rep.fenPath(cursor), (epd) => {
    const hit = t[epd];
    return hit ? { eco: hit[0], name: hit[1] } : undefined;
  });
}

export { openingText, type OpeningInfo } from '../domain';

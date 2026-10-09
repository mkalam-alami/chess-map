import { Repertoire, formatLine, type ChessMapData, type Cursor } from '../domain';
import { exportPgn } from '../pgn/export';

export const MAX_URL = 2000;
export const LICHESS_STUDY_URL = 'https://lichess.org/study';

/**
 * Lichess analysis board for a SAN line. The PGN is a URL path segment
 * (`/analysis/pgn/1.%20e4%20e5`); orientation is the `?color=black` query
 * parameter (verified: the page's embedded data has orientation "black").
 */
export function lichessAnalysisUrl(sans: string[], orientation: 'white' | 'black'): string {
  const base = `https://lichess.org/analysis/pgn/${encodeURIComponent(formatLine(sans))}`;
  return orientation === 'black' ? `${base}?color=black` : base;
}

export type LichessTarget = { kind: 'url'; url: string } | { kind: 'clipboard'; pgn: string; url: string };

/** Direct analysis URL for the line to the cursor, or (too long) the full-tree PGN to paste into a study. */
export function lichessTarget(map: ChessMapData, cursor: Cursor): LichessTarget {
  const url = lichessAnalysisUrl(Repertoire.fromData(map).sanPath(cursor), map.orientation);
  if (url.length <= MAX_URL) return { kind: 'url', url };
  return { kind: 'clipboard', pgn: exportPgn(map), url: LICHESS_STUDY_URL };
}

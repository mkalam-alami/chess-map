import { formatLine, type Cursor, type Repertoire } from '../../../domain';
import type { AnalysisBoard } from '../../../application';

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

/** The browser bits and the PGN writer, injected so the adapter is testable (and does not depend on the formats). */
export interface LichessDeps {
  /** Opens a page in a new tab. */
  open: (url: string) => void;
  writeClipboard: (text: string) => Promise<void>;
  /** The whole map as PGN, for lines too long for a URL. */
  writePgn: (map: Repertoire) => string;
}

/** Opens the line to the cursor on lichess.org, or (too long for a URL) copies the full-tree PGN and opens the study page. */
export class LichessAnalysisBoard implements AnalysisBoard {
  constructor(private readonly deps: LichessDeps) {}

  async open(map: Repertoire, cursor: Cursor): Promise<'opened' | 'copied'> {
    const url = lichessAnalysisUrl(map.sanPath(cursor), map.orientation);
    if (url.length <= MAX_URL) {
      this.deps.open(url);
      return 'opened';
    }
    await this.deps.writeClipboard(this.deps.writePgn(map));
    this.deps.open(LICHESS_STUDY_URL);
    return 'copied';
  }
}

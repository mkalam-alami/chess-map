import type { OpeningBook } from '../../../application';

/** EPD -> [eco, name]. */
export type OpeningTable = Record<string, [string, string]>;

/** The data is its own chunk (lichess-org/chess-openings, CC0; see scripts/gen-openings.mjs). */
const importTable = (): Promise<OpeningTable> => import('./openings.json').then((m) => m.default as unknown as OpeningTable);

/** Opening names from the lichess opening table, loaded lazily on `load`. */
export class LichessOpeningBook implements OpeningBook {
  private table: OpeningTable | null = null;
  private loading: Promise<void> | null = null;

  /** `loader` is the table source (tests inject a small one). */
  constructor(private readonly loader: () => Promise<OpeningTable> = importTable) {}

  /** Safe to call repeatedly; a failed load can be retried. */
  load(): Promise<void> {
    this.loading ??= this.loader().then(
      (t) => { this.table = t; },
      (e) => {
        this.loading = null;
        throw e;
      },
    );
    return this.loading;
  }

  lookup(epd: string): { eco: string; name: string } | undefined {
    const hit = this.table?.[epd];
    return hit ? { eco: hit[0], name: hit[1] } : undefined;
  }
}

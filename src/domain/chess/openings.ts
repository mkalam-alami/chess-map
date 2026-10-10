import { epd } from './rules';

export interface OpeningInfo {
  eco: string;
  name: string;
  /** The current position itself is named. */
  exact: boolean;
  /** Moves played since the deepest named position (0 when exact). */
  movesSince: number;
}

/** Opening book access: EPD (FEN fields 1-4) -> named position. */
export type OpeningLookup = (epd: string) => { eco: string; name: string } | undefined;

/** Deepest named position along `fens` (start position first, current position last); null when none is named. */
export function openingAt(fens: string[], lookup: OpeningLookup): OpeningInfo | null {
  for (let i = fens.length - 1; i >= 0; i--) {
    const hit = lookup(epd(fens[i] as string));
    if (hit) return { eco: hit.eco, name: hit.name, exact: i === fens.length - 1, movesSince: fens.length - 1 - i };
  }
  return null;
}

/** The name, with a `+n` suffix for out-of-book positions. */
export const openingText = (o: OpeningInfo): string => (o.exact ? o.name : `${o.name} +${o.movesSince}`);

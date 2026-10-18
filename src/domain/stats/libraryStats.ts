import { openingAt, type OpeningLookup } from '../chess/openings';
import type { Library } from '../library/Library';
import type { Repertoire } from '../repertoire/Repertoire';
import type { NodeId, Orientation } from '../repertoire/types';

export interface RankedCount { name: string; count: number }

/** Numbers about every map of a library. "Marker" is any node but the start position. */
export interface LibraryStats {
  maps: number;
  markers: number;
  moves: number;
  /** Markers with no continuation: the ends of the lines. */
  leaves: number;
  /** Moves from the start position to the deepest leaf. */
  maxDepth: number;
  /** Mean moves from the start position to a leaf (0 without leaves). */
  averageDepth: number;
  /** Markers with a non-blank note. */
  notes: number;
  /** Most frequent opening names by marker count, per side the maps are played as. */
  openings: Record<Orientation, RankedCount[]>;
  /** Most frequent places (reverse-geocoded labels) by marker count, per side. */
  places: Record<Orientation, RankedCount[]>;
}

const TOP = 5;

type Tally = Map<string, number>;
const bump = (t: Tally, key: string): void => void t.set(key, (t.get(key) ?? 0) + 1);
const top = (t: Tally): RankedCount[] =>
  [...t].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, TOP);

/**
 * Library-wide statistics. `lookup` names positions (the opening book); without names the opening rankings are
 * empty. Markers whose position or place is unknown are left out of the rankings.
 */
export function libraryStats(library: Library, lookup: OpeningLookup): LibraryStats {
  let markers = 0, moves = 0, notes = 0, leaves = 0, maxDepth = 0, depthSum = 0;
  const openings: Record<Orientation, Tally> = { white: new Map(), black: new Map() };
  const places: Record<Orientation, Tally> = { white: new Map(), black: new Map() };

  const visit = (rep: Repertoire, id: NodeId, depth: number): void => {
    const node = rep.node(id);
    const here = depth + node.moves.length;
    moves += node.moves.length;
    if (id !== rep.rootId) {
      markers++;
      if (node.note?.trim()) notes++;
      if (node.place) bump(places[rep.orientation], node.place.label);
      const opening = openingAt(rep.fenPath(rep.endOf(id)), lookup);
      if (opening) bump(openings[rep.orientation], opening.name);
      if (node.children.length === 0) {
        leaves++;
        depthSum += here;
        maxDepth = Math.max(maxDepth, here);
      }
    }
    for (const child of node.children) visit(rep, child, here);
  };
  for (const rep of library.repertoires()) visit(rep, rep.rootId, 0);

  return {
    maps: library.size, markers, moves, leaves, maxDepth, notes,
    averageDepth: leaves ? depthSum / leaves : 0,
    openings: { white: top(openings.white), black: top(openings.black) },
    places: { white: top(places.white), black: top(places.black) },
  };
}

import { describe, expect, it } from 'vitest';
import { epd, libraryStats } from '../../src/domain';
import { emptyRep, libraryWith, patchNode, pinnedOf, treeOf } from './fixtures';

const none = () => undefined;

describe('libraryStats', () => {
  it('is all zeros for an empty library', () => {
    expect(libraryStats(libraryWith(emptyRep()), none)).toEqual({
      maps: 1, markers: 0, moves: 0, leaves: 0, maxDepth: 0, averageDepth: 0, notes: 0,
      openings: { white: [], black: [] }, places: { white: [], black: [] },
    });
  });

  it('counts markers, moves, leaves and depth across every map', () => {
    const a = treeOf({ e4: { e5: { Nf3: {} }, c5: {} }, d4: {} });
    const b = treeOf({ c4: {} }, emptyRep('b'));
    const s = libraryStats(libraryWith(a.session.repertoire, b.session.repertoire), none);
    expect(s).toMatchObject({ maps: 2, markers: 6, moves: 6, leaves: 4, maxDepth: 3 });
    expect(s.averageDepth).toBeCloseTo((3 + 2 + 1 + 1) / 4);
  });

  it('counts a pinned segment as one marker with several moves, and its whole length in depth', () => {
    const { session } = pinnedOf(['e4', 'e5', 'Nf3']);
    expect(libraryStats(libraryWith(session.repertoire), none)).toMatchObject({ markers: 1, moves: 3, leaves: 1, maxDepth: 3, averageDepth: 3 });
  });

  it('counts non-blank notes', () => {
    const { session, id } = treeOf({ e4: { e5: {} } });
    let rep = patchNode(session.repertoire, id('e4'), { note: 'main line' });
    rep = patchNode(rep, id('e4 e5'), { note: '   ' });
    expect(libraryStats(libraryWith(rep), none).notes).toBe(1);
  });

  it('ranks openings and places by marker count, per side, top five', () => {
    const w = treeOf({ e4: { e5: {}, c5: {} } });
    const rep = w.session.repertoire;
    const names: Record<string, string> = { e4: "King's Pawn", 'e4 e5': 'Open Game', 'e4 c5': 'Sicilian' };
    const lookup = (e: string) => {
      const line = Object.keys(names).find((l) => epd(rep.fenAt(rep.endOf(w.id(l)))) === e);
      return line ? { eco: 'X', name: names[line] as string } : undefined;
    };
    const placed = patchNode(patchNode(rep, w.id('e4'), { place: { label: 'Lyon, France' } }), w.id('e4 e5'), { place: { label: 'Lyon, France' } });
    const black = emptyRep('b', 'black');
    const s = libraryStats(libraryWith(placed, black), lookup);
    expect(s.openings.white).toEqual([
      { name: "King's Pawn", count: 1 }, { name: 'Open Game', count: 1 }, { name: 'Sicilian', count: 1 },
    ]);
    expect(s.places.white).toEqual([{ name: 'Lyon, France', count: 2 }]);
    expect(s.openings.black).toEqual([]);
  });

  it('keeps at most five entries, ties broken by name', () => {
    const lines = Object.fromEntries(['a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3'].map((m) => [m, {}]));
    const t = treeOf(lines);
    const rep = t.session.repertoire;
    const byEpd = new Map(Object.keys(lines).map((m) => [epd(rep.fenAt(rep.endOf(t.id(m)))), m]));
    const s = libraryStats(libraryWith(rep), (e) => (byEpd.has(e) ? { eco: 'A00', name: byEpd.get(e) as string } : undefined));
    expect(s.openings.white.map((o) => o.name)).toEqual(['a3', 'b3', 'c3', 'd3', 'e3']);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_CENTER, Repertoire, type ChessMapData as ChessMap, type MapNodeData as MapNode } from '../../../src/domain';
import { ImportError } from '../../../src/application';
import { PgnMapFormat } from '../../../src/infrastructure/secondary/formats/PgnMapFormat';
import { exportPgn } from '../../../src/infrastructure/secondary/formats/pgn/export';
import { fan, importPgn } from '../../../src/infrastructure/secondary/formats/pgn/import';
import { childOf, editSession, emptyRep, patchNode, pinnedOf, spawn, treeOf } from '../../domain/fixtures';

/** Root -> child -> ... following child indexes (`nodeAt(m)` is the root). */
const getNode = (map: ChessMap, id: string): MapNode => Repertoire.fromData(map).node(id);
const nodeAt = (map: ChessMap, ...path: number[]): MapNode => path.reduce((n, i) => childOf(map, n.id, i), getNode(map, map.rootId));

/** The first map of a single-game PGN. */
const importOne = (pgn: string, opts?: Parameters<typeof importPgn>[1]): ChessMap => importPgn(pgn, opts)[0] as ChessMap;

/** Canonical, id-free description of a tree for equivalence checks. */
function shape(map: ChessMap, id = map.rootId): unknown {
  const n: MapNode = getNode(map, id);
  return {
    plies: n.plies, pinned: n.pinned, note: n.note, place: n.place, sizeDelta: n.sizeDelta,
    lngLat: n.lngLat.map((x) => Math.round(x * 1e5) / 1e5),
    children: n.children.map((c) => shape(map, c)),
  };
}

/** 1. e4 (1. d4) e5 (1... c5) 2. Nf3 Nc6 3. Bb5 a6 (pinned) 4. Ba4, with notes, places, sizes and odd characters. */
function sample(): ChessMap {
  const { session: s0, id } = treeOf({ e4: { e5: { Nf3: {} }, c5: {} }, d4: {} }, emptyRep('My Opening', 'black', [10, 20]));
  const nf3 = id('e4 e5 Nf3');
  let s = s0.relocate(id('e4'), [11.5, 21.25]).relocate(nf3, [-5.123456, 40.1]);
  s = s.goTo(s.repertoire.endOf(nf3)).toggleRecording();
  for (const san of ['Nc6', 'Bb5', 'a6']) s = s.play(san);
  s = s.toggleRecording();
  const ba4 = spawn(s, nf3, 'Ba4', [0.5, 0.5]);
  s = ba4.session.annotate(ba4.id, 'Ruy "Lopez" line');
  s = s.nameLocation(nf3, { label: 'Porto, Portugal', country: 'Portugal' }).nameLocation(id('d4'), { label: 'Odd {name} "x" [%y]' });
  s = s.annotate(s.repertoire.rootId, 'Start here').resizeBoard(id('e4'), 0.5).resizeBoard(id('e4 c5'), -1.25);
  return { ...s.repertoire.data, boardZoom: 2.5 };
}

describe('exportPgn', () => {
  const pgn = exportPgn(sample());

  it('writes the headers', () => {
    expect(pgn).toContain('[Event "My Opening"]');
    expect(pgn).toContain('[Orientation "black"]');
    expect(pgn).toContain('[Site "Chess Map"]');
    expect(pgn).toContain('[BoardZoom "2.5"]');
  });

  it('numbers moves correctly with variations', () => {
    expect(pgn).toMatch(/1\. e4 \{[^}]*\} \(1\. d4 \{[^}]*\}\) 1\.\.\. e5 \{[^}]*\} \(1\.\.\. c5 \{[^}]*\}\) 2\. Nf3 \{/);
    expect(pgn).toContain('3. Bb5');
    expect(pgn.trim().endsWith('*')).toBe(true);
  });

  it('writes geo, pinned, place and notes, escaping what would break the comment', () => {
    expect(pgn).toContain('{[%geo 20,10] Start here}');
    expect(pgn).toContain('[%geo 21.25,11.5]');
    expect(pgn).toContain('[%geo 40.1,-5.12346] [%pinned 1] [%place "Porto, Portugal"] [%country "Portugal"]');
    expect(pgn).toContain('Ruy "Lopez" line}');
    expect(pgn).not.toMatch(/Odd \{/);
    expect(pgn).toContain('%7Bname%7D');
  });

  it('lineOnly gives the plain SAN line to the cursor', () => {
    const m = sample();
    expect(exportPgn(m, { lineOnly: true, fromCursor: { nodeId: nodeAt(m, 0, 0).id, ply: 1 } })).toBe('1. e4 e5');
    expect(exportPgn(m, { lineOnly: true, fromCursor: { nodeId: nodeAt(m, 0).id, ply: 1 } })).toBe('1. e4');
  });

  it('fromCursor drops sibling branches on the path but keeps the subtree', () => {
    const m = sample();
    const fromC5 = exportPgn(m, { fromCursor: { nodeId: nodeAt(m, 0, 1).id, ply: 1 } });
    expect(fromC5).toContain('1. e4');
    expect(fromC5).toContain('c5');
    expect(fromC5).not.toContain('d4');
    expect(fromC5).not.toContain('e5');
  });
});

describe('importPgn', () => {
  const TEXT = `[Event "Hand"]
[Orientation "black"]

1. e4 {Best by test} (1. d4 d5 {answer} (1... Nf6 2. c4)) 1... e5 2. Nf3 Nc6 *
`;

  it('imports variations and comments as nodes', () => {
    const map = importOne(TEXT, { origin: [5, 5] });
    expect(map).toMatchObject({ name: 'Hand', orientation: 'black' });
    expect(nodeAt(map)).toMatchObject({ lngLat: [5, 5], children: { length: 2 } });
    expect(nodeAt(map, 0)).toMatchObject({ plies: ['e4'], note: 'Best by test', pinned: false });
    expect(nodeAt(map, 1).plies).toEqual(['d4']);
    expect(nodeAt(map, 1, 0)).toMatchObject({ plies: ['d5'], note: 'answer' });
    expect(nodeAt(map, 1, 1).plies).toEqual(['Nf6']);
    expect(Repertoire.fromData(map).sanPath({ nodeId: nodeAt(map, 1, 1, 0).id, ply: 1 })).toEqual(['d4', 'Nf6', 'c4']);
    expect(nodeAt(map, 0, 0, 0, 0).plies).toEqual(['Nc6']);
  });

  it('reports illegal moves with the move number', () => {
    expect(() => importPgn('1. e4 e5 2. Ke3 *')).toThrow(ImportError);
    expect(() => importPgn('1. e4 e5 2. Qh5 Nc6 3. Qxh8 *')).toThrow(/illegal move "Qxh8" at move 3\./);
    expect(() => importPgn('1. e4 e5 2. Nf3 Nf3 *')).toThrow(/at move 2\.\.\./); // black to move
  });

  it.each([
    ['custom start positions', '[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n[SetUp "1"]\n\n1. Ka2 *', /custom start positions/],
    ['empty input', '', ImportError],
    ['garbage', '1. e4 {unterminated', ImportError],
  ])('rejects %s', (_, text, error) => {
    expect(() => importPgn(text)).toThrow(error);
  });

  it('creates one map per game', () => {
    const maps = importPgn('[Event "A"]\n\n1. e4 *\n\n[Event "B"]\n\n1. d4 *\n');
    expect(maps.map((x) => x.name)).toEqual(['A', 'B']);
    expect(new Set(maps.map((x) => x.id)).size).toBe(2);
  });

  it('accepts a bare [%pinned] marker and merges geo-less follow-ups', () => {
    const m = importOne('1. e4 {[%geo 10,20] [%pinned]} e5 2. Nf3 {[%geo 11,21]} *');
    expect(nodeAt(m, 0)).toMatchObject({ pinned: true, plies: ['e4', 'e5'], lngLat: [20, 10] });
    expect(nodeAt(m, 0, 0).plies).toEqual(['Nf3']);
  });

  it('does not merge when the next move has variations', () => {
    const m = importOne('1. e4 {[%geo 10,20] [%pinned]} e5 (1... c5) 2. Nf3 *');
    expect(nodeAt(m, 0)).toMatchObject({ plies: ['e4'], children: { length: 2 } });
  });
});

describe('auto-placement', () => {
  it('is deterministic and siblings never overlap', () => {
    const text = '1. e4 (1. d4) (1. c4) (1. Nf3) (1. g3) 1... e5 2. Nf3 *';
    const a = importOne(text, { origin: [0, 0] });
    expect(shape(a)).toEqual(shape(importOne(text, { origin: [0, 0] })));
    const spots = nodeAt(a).children.map((c) => getNode(a, c).lngLat);
    expect(new Set(spots.map((p) => p.join(','))).size).toBe(5);
    for (const [lng, lat] of spots) {
      expect(Math.hypot(lng, lat)).toBeGreaterThan(1);
      expect(Math.hypot(lng, lat)).toBeLessThan(10);
    }
  });

  it('uses the default origin and keeps explicit geo', () => {
    const m = importOne('1. e4 {[%geo 1,2]} e5 *');
    expect(nodeAt(m).lngLat).toEqual(DEFAULT_CENTER);
    expect(nodeAt(m, 0).lngLat).toEqual([2, 1]);
    expect(nodeAt(m, 0, 0).lngLat).not.toEqual([2, 1]);
  });

  it('fan avoids occupied spots', () => {
    const p = fan([0, 0], 0, 0);
    expect(fan([0, 0], 0, 0, [p])).not.toEqual(p);
  });
});

describe('round trip', () => {
  it('importPgn(exportPgn(m)) yields an equivalent tree, sizes included', () => {
    const m = sample();
    const r = importOne(exportPgn(m));
    expect(shape(r)).toEqual(shape(m));
    expect(r).toMatchObject({ name: m.name, orientation: 'black', boardZoom: 2.5 });
  });

  it('keeps unpinned multi-ply segments and moved roots', () => {
    const { map, id } = pinnedOf(['e4', 'e5']);
    const unpinned = patchNode(Repertoire.fromData(map), id, { pinned: false });
    const m = editSession(unpinned).relocate(map.rootId, [3, 4]).repertoire.data;
    expect(shape(importOne(exportPgn(m)))).toEqual(shape(m));
  });

  it('handles black variations after white variations', () => {
    const { map } = treeOf({ e4: { e5: {}, c5: {} }, d4: {} });
    expect(shape(importOne(exportPgn(map)))).toEqual(shape(map));
  });
});

describe('PgnMapFormat', () => {
  const format = new PgnMapFormat();
  const ctx = { name: 'games.pgn', origin: [5, 5] as [number, number] };

  it('describes the file it writes', () => {
    expect(format).toMatchObject({ id: 'pgn', extension: 'pgn', mimeType: 'application/x-chess-pgn' });
  });

  it('writes a repertoire and reads it back as repertoires', () => {
    const rep = Repertoire.fromData(sample());
    const [back, ...rest] = format.read(format.write(rep), ctx);
    expect(rest).toEqual([]);
    expect(back).toBeInstanceOf(Repertoire);
    expect(shape((back as Repertoire).data)).toEqual(shape(rep.data));
  });

  it('names games after the file (without .pgn) when they have no Event, numbering several', () => {
    expect(format.read('1. e4 *', ctx).map((r) => r.name)).toEqual(['games']);
    expect(format.read('1. e4 *\n\n1. d4 *', ctx).map((r) => r.name)).toEqual(['games (1)', 'games (2)']);
  });

  it('places the first marker around the origin', () => {
    const [rep] = format.read('1. e4 *', ctx) as [Repertoire];
    expect(rep.node(rep.rootId).lngLat).toEqual([5, 5]);
  });

  it.each([
    ['empty text', '   ', /No PGN data/],
    ['text that is not PGN', '1. e4 {unterminated', /Could not parse PGN/],
    ['an illegal move', '1. e4 e5 2. Ke3 *', /Game 1: illegal move "Ke3" at move 2\./],
    ['a second game with an illegal move', '1. e4 *\n\n1. e5 *', /Game 2: illegal move "e5"/],
    ['a custom start position', '[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n[SetUp "1"]\n\n1. Ka2 *', /custom start positions/],
  ])('throws a readable ImportError for %s', (_, text, message) => {
    expect(() => format.read(text, ctx)).toThrow(ImportError);
    expect(() => format.read(text, ctx)).toThrow(message);
  });
});

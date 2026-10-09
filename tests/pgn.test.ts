import { describe, expect, it } from 'vitest';
import { sanPath } from '../src/chess/replay';
import { addChild, appendPly, createMap, moveNode, setNote, setPinned, setPlace } from '../src/model/tree';
import { getNode, type ChessMap, type MapNode } from '../src/model/types';
import { exportPgn } from '../src/pgn/export';
import { fan, importPgn, PgnImportError } from '../src/pgn/import';

/** Canonical, id-free description of a tree for equivalence checks. */
function shape(map: ChessMap, id = map.rootId): unknown {
  const n: MapNode = getNode(map, id);
  return {
    plies: n.plies, pinned: n.pinned, note: n.note, place: n.place,
    lngLat: n.lngLat.map((x) => Math.round(x * 1e5) / 1e5),
    children: n.children.map((c) => shape(map, c)),
  };
}

function sample(): ChessMap {
  let m = createMap('My Opening', 'black', [10, 20]);
  const e4 = addChild(m, m.rootId, 'e4', [11.5, 21.25]);
  m = e4.map;
  const d4 = addChild(m, m.rootId, 'd4', [9, 19]);
  m = d4.map;
  const e5 = addChild(m, e4.nodeId, 'e5', [12, 22]);
  m = e5.map;
  const c5 = addChild(m, e4.nodeId, 'c5', [13, 23]);
  m = c5.map;
  const nf3 = addChild(m, e5.nodeId, 'Nf3', [-5.123456, 40.1]);
  m = setPinned(nf3.map, nf3.nodeId, true);
  for (const s of ['Nc6', 'Bb5', 'a6']) m = appendPly(m, nf3.nodeId, s);
  const after = addChild(m, nf3.nodeId, 'Ba4', [0.5, 0.5]);
  m = setNote(after.map, after.nodeId, 'Ruy "Lopez" line');
  m = setPlace(m, nf3.nodeId, { label: 'Porto, Portugal', country: 'Portugal' });
  m = setPlace(m, d4.nodeId, { label: 'Odd {name} "x" [%y]' });
  m = setNote(m, m.rootId, 'Start here');
  return m;
}

describe('exportPgn', () => {
  it('numbers moves correctly with variations', () => {
    const pgn = exportPgn(sample());
    expect(pgn).toContain('[Event "My Opening"]');
    expect(pgn).toContain('[Orientation "black"]');
    expect(pgn).toContain('[Site "Chess Map"]');
    expect(pgn).toMatch(/1\. e4 \{[^}]*\} \(1\. d4 \{[^}]*\}\) 1\.\.\. e5 \{[^}]*\} \(1\.\.\. c5 \{[^}]*\}\) 2\. Nf3 \{/);
    expect(pgn.trim().endsWith('*')).toBe(true);
  });

  it('writes geo, pinned, place and notes', () => {
    const pgn = exportPgn(sample());
    expect(pgn).toContain('{[%geo 20,10] Start here}');
    expect(pgn).toContain('[%geo 21.25,11.5]');
    expect(pgn).toContain('[%geo 40.1,-5.12346] [%pinned 1] [%place "Porto, Portugal"] [%country "Portugal"]');
    expect(pgn).toContain('3. Bb5');
    expect(pgn).toContain('Ruy "Lopez" line}');
    expect(pgn).not.toMatch(/Odd \{/);
    expect(pgn).toContain('%7Bname%7D');
  });

  it('lineOnly gives the plain SAN line to the cursor', () => {
    const m = sample();
    const e4 = getNode(m, m.rootId).children[0] as string;
    const e5 = getNode(m, e4).children[0] as string;
    expect(exportPgn(m, { lineOnly: true, fromCursor: { nodeId: e5, ply: 1 } })).toBe('1. e4 e5');
    expect(exportPgn(m, { lineOnly: true, fromCursor: { nodeId: e4, ply: 1 } })).toBe('1. e4');
  });

  it('fromCursor drops sibling branches on the path but keeps the subtree', () => {
    const m = sample();
    const e4 = getNode(m, m.rootId).children[0] as string;
    const c5 = getNode(m, e4).children[1] as string;
    const pgn = exportPgn(m, { fromCursor: { nodeId: c5, ply: 1 } });
    expect(pgn).toContain('1. e4');
    expect(pgn).toContain('c5');
    expect(pgn).not.toContain('d4');
    expect(pgn).not.toContain('e5');
  });
});

describe('importPgn', () => {
  const TEXT = `[Event "Hand"]
[Orientation "black"]

1. e4 {Best by test} (1. d4 d5 {answer} (1... Nf6 2. c4)) 1... e5 2. Nf3 Nc6 *
`;

  it('imports variations and comments as nodes', () => {
    const map = importPgn(TEXT, { origin: [5, 5] })[0] as ChessMap;
    expect(map.name).toBe('Hand');
    expect(map.orientation).toBe('black');
    const root = getNode(map, map.rootId);
    expect(root.lngLat).toEqual([5, 5]);
    expect(root.children).toHaveLength(2);
    const e4 = getNode(map, root.children[0] as string);
    const d4 = getNode(map, root.children[1] as string);
    expect(e4.plies).toEqual(['e4']);
    expect(e4.note).toBe('Best by test');
    expect(e4.pinned).toBe(false);
    expect(d4.plies).toEqual(['d4']);
    const d5 = getNode(map, d4.children[0] as string);
    expect(d5.plies).toEqual(['d5']);
    expect(d5.note).toBe('answer');
    const nf6 = getNode(map, d4.children[1] as string);
    expect(nf6.plies).toEqual(['Nf6']);
    expect(sanPath(map, { nodeId: nf6.children[0] as string, ply: 1 })).toEqual(['d4', 'Nf6', 'c4']);
    const e5 = getNode(map, e4.children[0] as string);
    const nf3 = getNode(map, e5.children[0] as string);
    expect(getNode(map, nf3.children[0] as string).plies).toEqual(['Nc6']);
  });

  it('reports illegal moves with the move number', () => {
    expect(() => importPgn('1. e4 e5 2. Ke3 *')).toThrow(PgnImportError);
    expect(() => importPgn('1. e4 e5 2. Qh5 Nc6 3. Qxh8 *')).toThrow(/illegal move "Qxh8" at move 3\./);
  });

  it('names black-to-move errors with dots', () => {
    expect(() => importPgn('1. e4 e5 2. Nf3 Nf3 *')).toThrow(/at move 2\.\.\./);
  });

  it('rejects custom start positions', () => {
    expect(() => importPgn('[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n[SetUp "1"]\n\n1. Ka2 *')).toThrow(/custom start positions/);
  });

  it('rejects garbage and empty input', () => {
    expect(() => importPgn('')).toThrow(PgnImportError);
    expect(() => importPgn('1. e4 {unterminated')).toThrow(PgnImportError);
  });

  it('creates one map per game', () => {
    const maps = importPgn('[Event "A"]\n\n1. e4 *\n\n[Event "B"]\n\n1. d4 *\n');
    expect(maps.map((x) => x.name)).toEqual(['A', 'B']);
    expect(new Set(maps.map((x) => x.id)).size).toBe(2);
  });

  it('accepts a bare [%pinned] marker and merges geo-less follow-ups', () => {
    const m = importPgn('1. e4 {[%geo 10,20] [%pinned]} e5 2. Nf3 {[%geo 11,21]} *')[0] as ChessMap;
    const e4 = getNode(m, getNode(m, m.rootId).children[0] as string);
    expect(e4.pinned).toBe(true);
    expect(e4.plies).toEqual(['e4', 'e5']);
    expect(e4.lngLat).toEqual([20, 10]);
    expect(getNode(m, e4.children[0] as string).plies).toEqual(['Nf3']);
  });

  it('does not merge when the next move has variations', () => {
    const m = importPgn('1. e4 {[%geo 10,20] [%pinned]} e5 (1... c5) 2. Nf3 *')[0] as ChessMap;
    const e4 = getNode(m, getNode(m, m.rootId).children[0] as string);
    expect(e4.plies).toEqual(['e4']);
    expect(e4.children).toHaveLength(2);
  });
});

describe('auto-placement', () => {
  it('is deterministic and siblings never overlap', () => {
    const text = '1. e4 (1. d4) (1. c4) (1. Nf3) (1. g3) 1... e5 2. Nf3 *';
    const a = importPgn(text, { origin: [0, 0] })[0] as ChessMap;
    const b = importPgn(text, { origin: [0, 0] })[0] as ChessMap;
    expect(shape(a)).toEqual(shape(b));
    const root = getNode(a, a.rootId);
    const pts = root.children.map((c) => getNode(a, c).lngLat.join(','));
    expect(new Set(pts).size).toBe(5);
    for (const c of root.children) {
      const [lng, lat] = getNode(a, c).lngLat;
      const d = Math.hypot(lng, lat);
      expect(d).toBeGreaterThan(1);
      expect(d).toBeLessThan(10);
    }
  });

  it('uses the default origin and keeps explicit geo', () => {
    const m = importPgn('1. e4 {[%geo 1,2]} e5 *')[0] as ChessMap;
    expect(getNode(m, m.rootId).lngLat).toEqual([2.35, 48.85]);
    const e4 = getNode(m, getNode(m, m.rootId).children[0] as string);
    expect(e4.lngLat).toEqual([2, 1]);
    expect(getNode(m, e4.children[0] as string).lngLat).not.toEqual([2, 1]);
  });

  it('fan avoids occupied spots', () => {
    const p = fan([0, 0], 0, 0);
    expect(fan([0, 0], 0, 0, [p])).not.toEqual(p);
  });
});

describe('round trip', () => {
  it('importPgn(exportPgn(m)) yields an equivalent tree', () => {
    const m = sample();
    const r = importPgn(exportPgn(m))[0] as ChessMap;
    expect(shape(r)).toEqual(shape(m));
    expect(r.name).toBe(m.name);
    expect(r.orientation).toBe('black');
    expect(getNode(r, r.rootId).note).toBe('Start here');
  });

  it('keeps unpinned multi-ply segments and moved roots', () => {
    let m = createMap('x', 'white', [1, 1]);
    const a = addChild(m, m.rootId, 'e4', [2, 2]);
    m = setPinned(a.map, a.nodeId, true);
    m = appendPly(m, a.nodeId, 'e5');
    m = setPinned(m, a.nodeId, false);
    m = moveNode(m, m.rootId, [3, 4]);
    const r = importPgn(exportPgn(m))[0] as ChessMap;
    expect(shape(r)).toEqual(shape(m));
  });

  it('handles black variations after white variations', () => {
    let m = createMap('x', 'white', [0, 0]);
    const a = addChild(m, m.rootId, 'e4', [1, 1]);
    m = addChild(a.map, a.nodeId, 'e5', [2, 2]).map;
    m = addChild(m, a.nodeId, 'c5', [3, 3]).map;
    m = addChild(m, m.rootId, 'd4', [4, 4]).map;
    const r = importPgn(exportPgn(m))[0] as ChessMap;
    expect(shape(r)).toEqual(shape(m));
  });
});

import { describe, expect, it } from 'vitest';
import { fenAt, formatLine, legalDests, moveLabel, sanPath, tryMove, turnColor } from '../src/chess/replay';
import { cursorBack, cursorEnd, cursorForward, rootCursor } from '../src/model/cursor';
import {
  addChild, appendPly, branchAt, createMap, deleteSubtree, findTranspositions, moveNode, pathTo, setLastChild,
  setNote, setPinned, splitSegment, subtreeSize, undoLastPly,
} from '../src/model/tree';
import { getNode, type ChessMap } from '../src/model/types';

const O: [number, number] = [0, 0];

/** root -> e4 -> e5 (markers) */
function line(sans: string[]) {
  let map = createMap('t', 'white', O);
  let id = map.rootId;
  const ids: string[] = [id];
  sans.forEach((s, i) => {
    const r = addChild(map, id, s, [i + 1, i + 1]);
    map = r.map;
    id = r.nodeId;
    ids.push(id);
  });
  return { map, ids };
}

/** root -> pinned [e4 e5 Nf3 Nc6] */
function pinnedLine(sans: string[]) {
  const { map: m0, ids } = line([sans[0] as string]);
  let map = setPinned(m0, ids[1] as string, true);
  for (const s of sans.slice(1)) map = appendPly(map, ids[1] as string, s);
  return { map, id: ids[1] as string };
}

describe('addChild', () => {
  it('dedupes by first ply', () => {
    const { map, ids } = line(['e4']);
    const r = addChild(map, map.rootId, 'e4', [9, 9]);
    expect(r.nodeId).toBe(ids[1]);
    expect(r.map).toBe(map);
    const r2 = addChild(map, map.rootId, 'd4', [9, 9]);
    expect(getNode(r2.map, map.rootId).children).toHaveLength(2);
    expect(getNode(r2.map, map.rootId).lastChild).toBe(r2.nodeId);
  });
  it('does not mutate input', () => {
    const map = createMap('t', 'white', O);
    const before = JSON.stringify(map);
    addChild(map, map.rootId, 'e4', O);
    expect(JSON.stringify(map)).toBe(before);
  });
});

describe('split / branch', () => {
  it('splits a pinned segment when branching mid-way', () => {
    const { map, id } = pinnedLine(['e4', 'e5', 'Nf3', 'Nc6']);
    const child = addChild(map, id, 'Bb5', [5, 5]);
    const r = branchAt(child.map, { nodeId: id, ply: 2 }, 'f4', [7, 7]);
    const head = getNode(r.map, id);
    expect(head.plies).toEqual(['e4', 'e5']);
    expect(head.children).toHaveLength(2);
    const tail = getNode(r.map, head.children[0] as string);
    expect(tail.plies).toEqual(['Nf3', 'Nc6']);
    expect(tail.pinned).toBe(true);
    expect(tail.lngLat).toEqual(head.lngLat);
    expect(tail.children).toEqual([child.nodeId]);
    expect(getNode(r.map, child.nodeId).parentId).toBe(tail.id);
    expect(getNode(r.map, r.cursor.nodeId).plies).toEqual(['f4']);
    expect(r.cursor.ply).toBe(1);
    expect(sanPath(r.map, r.cursor)).toEqual(['e4', 'e5', 'f4']);
    expect(sanPath(r.map, { nodeId: child.nodeId, ply: 1 })).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  });
  it('reuses an existing move mid-segment and at the end', () => {
    const { map, id } = pinnedLine(['e4', 'e5', 'Nf3']);
    const r = branchAt(map, { nodeId: id, ply: 1 }, 'e5', O);
    expect(r.map).toBe(map);
    expect(r.cursor).toEqual({ nodeId: id, ply: 2 });
    const { map: m2, ids } = line(['e4']);
    const r2 = branchAt(m2, cursorEnd(m2, ids[1] as string), 'e5', O);
    const r3 = branchAt(r2.map, cursorEnd(r2.map, ids[1] as string), 'e5', O);
    expect(r3.cursor).toEqual(r2.cursor);
  });
  it('splitSegment validates the ply', () => {
    const { map, id } = pinnedLine(['e4', 'e5']);
    expect(() => splitSegment(map, id, 0)).toThrow();
    expect(() => splitSegment(map, id, 2)).toThrow();
  });
});

describe('undoLastPly', () => {
  it('drops the last ply of a pinned leaf but never below 1', () => {
    const { map, id } = pinnedLine(['e4', 'e5']);
    const m1 = undoLastPly(map, id);
    expect(getNode(m1, id).plies).toEqual(['e4']);
    expect(undoLastPly(m1, id)).toBe(m1);
  });
  it('refuses nodes with children and the root', () => {
    const { map, id } = pinnedLine(['e4', 'e5']);
    const withChild = addChild(map, id, 'Nf3', O).map;
    expect(undoLastPly(withChild, id)).toBe(withChild);
    expect(undoLastPly(map, map.rootId)).toBe(map);
  });
  it('appendPly requires a pinned leaf', () => {
    const { map, ids } = line(['e4']);
    expect(() => appendPly(map, ids[1] as string, 'e5')).toThrow();
  });
});

describe('delete / move', () => {
  it('deletes a subtree and fixes the parent', () => {
    const { map, ids } = line(['e4', 'e5', 'Nf3']);
    expect(subtreeSize(map, ids[1] as string)).toBe(3);
    const r = deleteSubtree(map, ids[2] as string);
    expect(r.removed).toBe(2);
    expect(Object.keys(r.map.nodes)).toHaveLength(2);
    const parent = getNode(r.map, ids[1] as string);
    expect(parent.children).toEqual([]);
    expect(parent.lastChild).toBeUndefined();
    expect(() => deleteSubtree(map, map.rootId)).toThrow();
  });
  it('moves a node alone or with its subtree', () => {
    const { map, ids } = line(['e4', 'e5', 'Nf3']);
    const alone = moveNode(map, ids[1] as string, [10, 10]);
    expect(getNode(alone, ids[1] as string).lngLat).toEqual([10, 10]);
    expect(getNode(alone, ids[2] as string).lngLat).toEqual([2, 2]);
    const tree = moveNode(map, ids[1] as string, [11, 21], { withSubtree: true });
    expect(getNode(tree, ids[1] as string).lngLat).toEqual([11, 21]);
    expect(getNode(tree, ids[2] as string).lngLat).toEqual([12, 22]);
    expect(getNode(tree, ids[3] as string).lngLat).toEqual([13, 23]);
    expect(getNode(map, ids[3] as string).lngLat).toEqual([3, 3]);
  });
  it('notes and pathTo', () => {
    const { map, ids } = line(['e4', 'e5']);
    const n = setNote(map, ids[1] as string, 'hi');
    expect(getNode(n, ids[1] as string).note).toBe('hi');
    expect(getNode(setNote(n, ids[1] as string, ' '), ids[1] as string).note).toBeUndefined();
    expect(pathTo(map, ids[2] as string)).toEqual(ids);
  });
});

describe('cursor', () => {
  it('walks back and forward across segments', () => {
    const { map, id } = pinnedLine(['e4', 'e5', 'Nf3']);
    const child = addChild(map, id, 'Nc6', O);
    const m = child.map;
    const c = { nodeId: child.nodeId, ply: 1 };
    expect(cursorBack(m, c)).toEqual({ nodeId: id, ply: 3 });
    expect(cursorBack(m, { nodeId: id, ply: 3 })).toEqual({ nodeId: id, ply: 2 });
    expect(cursorBack(m, { nodeId: id, ply: 1 })).toEqual(rootCursor(m));
    expect(cursorBack(m, rootCursor(m))).toBeNull();
    expect(cursorForward(m, rootCursor(m))).toEqual({ nodeId: id, ply: 1 });
    expect(cursorForward(m, { nodeId: id, ply: 3 })).toEqual(c);
    expect(cursorForward(m, c)).toBeNull();
  });
  it('forward follows lastChild, null when ambiguous', () => {
    let { map, ids } = line(['e4']);
    const d4 = addChild(map, map.rootId, 'd4', O);
    map = d4.map;
    expect(cursorForward(map, rootCursor(map))).toEqual({ nodeId: d4.nodeId, ply: 1 });
    map = setLastChild(map, map.rootId, ids[1] as string);
    expect(cursorForward(map, rootCursor(map))).toEqual({ nodeId: ids[1], ply: 1 });
    const { lastChild: _l, ...root } = getNode(map, map.rootId);
    const noLast: ChessMap = { ...map, nodes: { ...map.nodes, [map.rootId]: root } };
    expect(cursorForward(noLast, rootCursor(noLast))).toBeNull();
  });
});

describe('replay helpers', () => {
  it('fenAt and sanPath', () => {
    const { map, ids } = line(['e4', 'e5']);
    expect(fenAt(map, rootCursor(map))).toContain('rnbqkbnr/pppppppp');
    const fen = fenAt(map, { nodeId: ids[1] as string, ply: 1 });
    expect(fen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
    expect(turnColor(fen)).toBe('black');
    expect(sanPath(map, { nodeId: ids[2] as string, ply: 1 })).toEqual(['e4', 'e5']);
    expect(sanPath(map, rootCursor(map))).toEqual([]);
  });
  it('formatLine and moveLabel', () => {
    expect(formatLine(['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
    expect(formatLine(['e5', 'Nf3'], 1)).toBe('1… e5 2. Nf3');
    expect(formatLine([])).toBe('');
    expect(moveLabel(0, 'e4')).toBe('1.e4');
    expect(moveLabel(1, 'e5')).toBe('1…e5');
    expect(moveLabel(4, 'Nf3')).toBe('3.Nf3');
  });
});

describe('tryMove / legalDests', () => {
  const map = createMap('t', 'white', O);
  const fen = fenAt(map, rootCursor(map));
  it('plays san and from/to, rejects illegal', () => {
    expect(tryMove(fen, 'e4')?.san).toBe('e4');
    expect(tryMove(fen, { from: 'g1', to: 'f3' })?.san).toBe('Nf3');
    expect(tryMove(fen, 'e5')).toBeNull();
    expect(tryMove(fen, { from: 'e2', to: 'e5' })).toBeNull();
  });
  it('lists dests', () => {
    const d = legalDests(fen);
    expect(d.get('e2')).toEqual(expect.arrayContaining(['e3', 'e4']));
    expect(d.get('g1')?.sort()).toEqual(['f3', 'h3']);
    expect(d.has('e1')).toBe(false);
  });
});

describe('transpositions', () => {
  it('finds the same position via a different move order', () => {
    let map = createMap('t', 'white', O);
    const a = [...['Nf3', 'Nf6', 'Nc3']];
    const b = ['Nc3', 'Nf6', 'Nf3'];
    let ca = map.rootId;
    for (const s of a) { const r = addChild(map, ca, s, O); map = r.map; ca = r.nodeId; }
    let cb = map.rootId;
    for (const s of b) { const r = addChild(map, cb, s, O); map = r.map; cb = r.nodeId; }
    const t = findTranspositions(map, { nodeId: ca, ply: 1 });
    expect(t).toEqual([{ nodeId: cb, ply: 1 }]);
    expect(findTranspositions(map, { nodeId: map.rootId, ply: 0 })).toEqual([]);
  });
});

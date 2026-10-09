import { describe, expect, it } from 'vitest';
import {
  START_FEN, epd, fenAt, fenPath, firstPlyIndex, formatLine, inCheck, legalDests, moveLabel, moveSquares, pinLabel, promotionColor,
  sanPath, tryMove, turnColor,
} from '../src/chess/replay';
import { cursorBack, cursorEnd, cursorForward, lineCursors, nextCursor, rootCursor } from '../src/model/cursor';
import {
  addChild, appendPly, branchAt, createMap, deleteSubtree, findTranspositions, moveNode, nodeDistances, pathTo,
  setNote, splitSegment, subtreeSize, undoLastPly,
} from '../src/model/tree';
import { getNode } from '../src/model/types';
import { O, childOf, lineOf, patchNode, pinnedOf, treeOf } from './fixtures';

describe('addChild', () => {
  it('dedupes by first ply', () => {
    const { map, ids } = lineOf(['e4']);
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
    const { map, id } = pinnedOf(['e4', 'e5', 'Nf3', 'Nc6']);
    const child = addChild(map, id, 'Bb5', [5, 5]);
    const r = branchAt(child.map, { nodeId: id, ply: 2 }, 'f4', [7, 7]);
    const head = getNode(r.map, id);
    expect(head.plies).toEqual(['e4', 'e5']);
    expect(head.children).toHaveLength(2);
    const tail = childOf(r.map, id);
    expect(tail).toMatchObject({ plies: ['Nf3', 'Nc6'], pinned: true, lngLat: head.lngLat, children: [child.nodeId] });
    expect(getNode(r.map, child.nodeId).parentId).toBe(tail.id);
    expect(r.cursor).toEqual({ nodeId: childOf(r.map, id, 1).id, ply: 1 });
    expect(sanPath(r.map, r.cursor)).toEqual(['e4', 'e5', 'f4']);
    expect(sanPath(r.map, { nodeId: child.nodeId, ply: 1 })).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  });
  it('reuses an existing move mid-segment', () => {
    const { map, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    const r = branchAt(map, { nodeId: id, ply: 1 }, 'e5', O);
    expect(r.map).toBe(map);
    expect(r.cursor).toEqual({ nodeId: id, ply: 2 });
  });
  it('reuses an existing move at the end of a node', () => {
    const { map, ids } = lineOf(['e4']);
    const r2 = branchAt(map, cursorEnd(map, ids[1] as string), 'e5', O);
    const r3 = branchAt(r2.map, cursorEnd(r2.map, ids[1] as string), 'e5', O);
    expect(r3.cursor).toEqual(r2.cursor);
  });
  it.each([0, 2])('splitSegment rejects ply %i', (ply) => {
    const { map, id } = pinnedOf(['e4', 'e5']);
    expect(() => splitSegment(map, id, ply)).toThrow();
  });
});

describe('undoLastPly', () => {
  it('drops the last ply of a pinned leaf but never below 1', () => {
    const { map, id } = pinnedOf(['e4', 'e5']);
    const m1 = undoLastPly(map, id);
    expect(getNode(m1, id).plies).toEqual(['e4']);
    expect(undoLastPly(m1, id)).toBe(m1);
  });
  it('refuses nodes with children and the root', () => {
    const { map, id } = pinnedOf(['e4', 'e5']);
    const withChild = addChild(map, id, 'Nf3', O).map;
    expect(undoLastPly(withChild, id)).toBe(withChild);
    expect(undoLastPly(map, map.rootId)).toBe(map);
  });
  it('appendPly requires a pinned leaf', () => {
    const { map, ids } = lineOf(['e4']);
    expect(() => appendPly(map, ids[1] as string, 'e5')).toThrow();
  });
});

describe('deleteSubtree', () => {
  it('removes the subtree and fixes the parent', () => {
    const { map, ids } = lineOf(['e4', 'e5', 'Nf3']);
    expect(subtreeSize(map, ids[1] as string)).toBe(3);
    const r = deleteSubtree(map, ids[2] as string);
    expect(r.removed).toBe(2);
    expect(Object.keys(r.map.nodes)).toHaveLength(2);
    const parent = getNode(r.map, ids[1] as string);
    expect(parent.children).toEqual([]);
    expect(parent.lastChild).toBeUndefined();
  });
  it('never deletes the root', () => {
    const { map } = lineOf(['e4']);
    expect(() => deleteSubtree(map, map.rootId)).toThrow();
  });
});

describe('moveNode', () => {
  const { map, ids } = lineOf(['e4', 'e5', 'Nf3']);
  const [, e4, e5, nf3] = ids as [string, string, string, string];
  it('moves a node alone', () => {
    const alone = moveNode(map, e4, [10, 10]);
    expect(getNode(alone, e4).lngLat).toEqual([10, 10]);
    expect(getNode(alone, e5).lngLat).toEqual([2, 2]);
  });
  it('moves a node with its subtree, without touching the input', () => {
    const moved = moveNode(map, e4, [11, 21], { withSubtree: true });
    expect([e4, e5, nf3].map((id) => getNode(moved, id).lngLat)).toEqual([[11, 21], [12, 22], [13, 23]]);
    expect(getNode(map, nf3).lngLat).toEqual([3, 3]);
  });
});

describe('setNote', () => {
  it('sets a note and removes it when blank', () => {
    const { map, ids } = lineOf(['e4']);
    const id = ids[1] as string;
    const n = setNote(map, id, 'hi');
    expect(getNode(n, id).note).toBe('hi');
    expect('note' in getNode(setNote(n, id, ' '), id)).toBe(false);
  });
});

describe('pathTo', () => {
  it('lists ids from the root down', () => {
    const { map, ids } = lineOf(['e4', 'e5']);
    expect(pathTo(map, ids[2] as string)).toEqual(ids);
  });
});

describe('cursor', () => {
  it('walks back and forward across segments', () => {
    const { map, id } = pinnedOf(['e4', 'e5', 'Nf3']);
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
    const { map, id } = treeOf({ e4: {}, d4: {} });
    expect(cursorForward(map, rootCursor(map))).toEqual({ nodeId: id('d4'), ply: 1 });
    const toE4 = patchNode(map, map.rootId, { lastChild: id('e4') });
    expect(cursorForward(toE4, rootCursor(toE4))).toEqual({ nodeId: id('e4'), ply: 1 });
    const noLast = patchNode(map, map.rootId, { lastChild: undefined });
    expect(cursorForward(noLast, rootCursor(noLast))).toBeNull();
  });
  it('nextCursor finds the next ply of a segment or a child, null for new moves', () => {
    const { map, id } = pinnedOf(['e4', 'e5']);
    expect(nextCursor(map, rootCursor(map), 'e4')).toEqual({ nodeId: id, ply: 1 });
    expect(nextCursor(map, rootCursor(map), 'd4')).toBeNull();
    expect(nextCursor(map, { nodeId: id, ply: 1 }, 'e5')).toEqual({ nodeId: id, ply: 2 });
    expect(nextCursor(map, { nodeId: id, ply: 1 }, 'c5')).toBeNull();
  });
  it('lineCursors has one cursor per ply of the line', () => {
    const { map, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    const child = addChild(map, id, 'Nc6', O);
    const cursors = lineCursors(child.map, { nodeId: child.nodeId, ply: 1 });
    expect(cursors).toEqual([1, 2, 3].map((ply) => ({ nodeId: id, ply })).concat({ nodeId: child.nodeId, ply: 1 }));
    expect(lineCursors(map, { nodeId: id, ply: 2 })).toHaveLength(2);
    expect(lineCursors(map, rootCursor(map))).toEqual([]);
  });
});

describe('replay helpers', () => {
  const { map, ids } = lineOf(['e4', 'e5']);
  const e4 = { nodeId: ids[1] as string, ply: 1 };
  const e5 = { nodeId: ids[2] as string, ply: 1 };
  it('fenAt, fenPath and sanPath', () => {
    expect(fenAt(map, rootCursor(map))).toBe(START_FEN);
    const fen = fenAt(map, e4);
    expect(fen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
    expect(turnColor(fen)).toBe('black');
    expect(sanPath(map, e5)).toEqual(['e4', 'e5']);
    expect(sanPath(map, rootCursor(map))).toEqual([]);
    expect(fenPath(map, e5)).toEqual([START_FEN, fen, fenAt(map, e5)]);
    expect(fenPath(map, rootCursor(map))).toEqual([START_FEN]);
  });
  it('epd drops the move counters', () => {
    expect(epd(START_FEN)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });
  it('formatLine and moveLabel', () => {
    expect(formatLine(['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
    expect(formatLine(['e5', 'Nf3'], 1)).toBe('1… e5 2. Nf3');
    expect(formatLine([])).toBe('');
    expect(moveLabel(0, 'e4')).toBe('1.e4');
    expect(moveLabel(1, 'e5')).toBe('1…e5');
    expect(moveLabel(4, 'Nf3')).toBe('3.Nf3');
  });
  it('pinLabel numbers the first ply and counts the rest of a segment', () => {
    const { map: pm, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    expect(pinLabel(pm, getNode(pm, pm.rootId))).toBe('♟');
    expect(pinLabel(pm, getNode(pm, id))).toBe('1.e4 … (+2)');
    expect(pinLabel(map, getNode(map, e5.nodeId))).toBe('1…e5');
    expect(firstPlyIndex(map, getNode(map, e5.nodeId))).toBe(1);
  });
});

describe('tryMove / legalDests / board helpers', () => {
  it('plays san and from/to, rejects illegal', () => {
    expect(tryMove(START_FEN, 'e4')?.san).toBe('e4');
    expect(tryMove(START_FEN, { from: 'g1', to: 'f3' })?.san).toBe('Nf3');
    expect(tryMove(START_FEN, 'e5')).toBeNull();
    expect(tryMove(START_FEN, { from: 'e2', to: 'e5' })).toBeNull();
  });
  it('lists dests', () => {
    const d = legalDests(START_FEN);
    expect(d.get('e2')).toEqual(expect.arrayContaining(['e3', 'e4']));
    expect(d.get('g1')?.sort()).toEqual(['f3', 'h3']);
    expect(d.has('e1')).toBe(false);
  });
  it('detects promotions, checks and move squares', () => {
    const promo = '8/4P3/8/8/8/8/k7/4K3 w - - 0 1';
    expect(promotionColor(promo, 'e7', 'e8')).toBe('white');
    expect(promotionColor(START_FEN, 'e2', 'e4')).toBeNull();
    expect(inCheck(START_FEN)).toBe(false);
    expect(inCheck('4k3/8/8/8/8/8/8/4K2r w - - 0 1')).toBe(true);
    expect(moveSquares(START_FEN, 'Nf3')).toEqual(['g1', 'f3']);
    expect(moveSquares(START_FEN, 'Nf6')).toBeUndefined();
  });
});

describe('transpositions', () => {
  it('finds the same position via a different move order', () => {
    const { map, id } = treeOf({ Nf3: { Nf6: { Nc3: {} } }, Nc3: { Nf6: { Nf3: {} } } });
    expect(findTranspositions(map, { nodeId: id('Nf3 Nf6 Nc3'), ply: 1 })).toEqual([{ nodeId: id('Nc3 Nf6 Nf3'), ply: 1 }]);
    expect(findTranspositions(map, rootCursor(map))).toEqual([]);
  });
});

describe('nodeDistances', () => {
  it('counts markers up and down the tree', () => {
    const { map, id } = treeOf({ e4: { e5: { Nf3: {} } }, d4: {} });
    const d = nodeDistances(map, id('e4'));
    expect(d.get(id('e4'))).toBe(0);
    expect(d.get(map.rootId)).toBe(1);
    expect(d.get(id('e4 e5'))).toBe(1);
    expect(d.get(id('d4'))).toBe(2); // sibling via the root
    expect(d.get(id('e4 e5 Nf3'))).toBe(2);
    expect(nodeDistances(map, id('e4 e5 Nf3')).get(id('d4'))).toBe(4);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD_ZOOM, Repertoire, START_FEN, sameCursor, turnColor, type ChessMapData } from '../../src/domain';
import * as cmd from '../../src/domain/repertoire/commands';
import { O, childOf, emptyRep, lineOf, patchNode, pinnedOf, treeOf } from './fixtures';

const rep = (data: ChessMapData): Repertoire => Repertoire.fromData(data);

describe('creating and wrapping', () => {
  it('a new repertoire has only the start position', () => {
    const r = Repertoire.create('Sicilian', 'black', [3, 4]);
    expect(r).toMatchObject({ name: 'Sicilian', orientation: 'black' });
    expect(r.nodes()).toHaveLength(1);
    expect(r.node(r.rootId)).toMatchObject({ parentId: null, moves: [], pinned: false, lngLat: [3, 4], children: [] });
    expect(r.rootCursor()).toEqual({ nodeId: r.rootId, played: 0 });
    expect(r.view).toBeUndefined();
    expect(r.boardZoom).toBe(DEFAULT_BOARD_ZOOM);
  });

  it('two new repertoires never share ids', () => {
    expect(emptyRep().id).not.toBe(emptyRep().id);
  });

  it('fromData / data round-trip the very same object', () => {
    const { map } = lineOf(['e4']);
    expect(rep(map).data).toBe(map);
  });

  it('fromData refuses data without a root node', () => {
    const r = emptyRep();
    expect(() => Repertoire.fromData({ ...r.data, nodes: {} })).toThrow(/no root/);
  });

  it('node() throws on unknown ids while hasNode() answers', () => {
    const r = emptyRep();
    expect(() => r.node('nope')).toThrow('Unknown node nope');
    expect(r.hasNode('nope')).toBe(false);
    expect(r.hasNode(r.rootId)).toBe(true);
  });
});

describe('navigation', () => {
  it('walks back and forward across segments', () => {
    const { session, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    const { session: s2, id: child } = (() => {
      const s = session.goTo(session.repertoire.endOf(id)).play('Nc6', [O]).confirmPlacing();
      return { session: s, id: s.repertoire.node(id).children[0] as string };
    })();
    const m = s2.repertoire;
    const c = { nodeId: child, played: 1 };
    expect(m.back(c)).toEqual({ nodeId: id, played: 3 });
    expect(m.back({ nodeId: id, played: 3 })).toEqual({ nodeId: id, played: 2 });
    expect(m.back({ nodeId: id, played: 1 })).toEqual(m.rootCursor());
    expect(m.back(m.rootCursor())).toBeNull();
  });

  it('next() finds the next move of a segment or a child, null for a new move', () => {
    const { map, id } = pinnedOf(['e4', 'e5']);
    const r = rep(map);
    expect(r.next(r.rootCursor(), 'e4')).toEqual({ nodeId: id, played: 1 });
    expect(r.next(r.rootCursor(), 'd4')).toBeNull();
    expect(r.next({ nodeId: id, played: 1 }, 'e5')).toEqual({ nodeId: id, played: 2 });
    expect(r.next({ nodeId: id, played: 1 }, 'c5')).toBeNull();
    expect(r.next({ nodeId: id, played: 2 }, 'Nf3')).toBeNull();
  });

  it('lineCursors has one cursor per move of the line (parallel to sanPath)', () => {
    const { session, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    const s = session.goTo(session.repertoire.endOf(id)).play('Nc6', [O]).confirmPlacing();
    const r = s.repertoire;
    const child = r.node(id).children[0] as string;
    expect(r.lineCursors({ nodeId: child, played: 1 })).toEqual([1, 2, 3].map((played) => ({ nodeId: id, played })).concat({ nodeId: child, played: 1 }));
    expect(r.lineCursors({ nodeId: id, played: 2 })).toHaveLength(2);
    expect(r.lineCursors(r.rootCursor())).toEqual([]);
    expect(r.lineCursors({ nodeId: child, played: 1 })).toHaveLength(r.sanPath({ nodeId: child, played: 1 }).length);
  });

  it('sameCursor compares node and number of moves played', () => {
    expect(sameCursor({ nodeId: 'a', played: 1 }, { nodeId: 'a', played: 1 })).toBe(true);
    expect(sameCursor({ nodeId: 'a', played: 1 }, { nodeId: 'a', played: 2 })).toBe(false);
    expect(sameCursor({ nodeId: 'a', played: 1 }, { nodeId: 'b', played: 1 })).toBe(false);
  });

  it('endOf is the cursor after the whole segment', () => {
    const { map, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    expect(rep(map).endOf(id)).toEqual({ nodeId: id, played: 3 });
    expect(rep(map).endOf(map.rootId)).toEqual({ nodeId: map.rootId, played: 0 });
  });

  it('pathTo lists ids from the root down', () => {
    const { map, ids } = lineOf(['e4', 'e5']);
    expect(rep(map).pathTo(ids[2] as string)).toEqual(ids);
  });
});

describe('positions', () => {
  const { map, ids } = lineOf(['e4', 'e5']);
  const r = rep(map);
  const e4 = { nodeId: ids[1] as string, played: 1 };
  const e5 = { nodeId: ids[2] as string, played: 1 };

  it('fenAt, fenPath and sanPath follow the line', () => {
    expect(r.fenAt(r.rootCursor())).toBe(START_FEN);
    const fen = r.fenAt(e4);
    expect(fen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
    expect(turnColor(fen)).toBe('black');
    expect(r.sanPath(e5)).toEqual(['e4', 'e5']);
    expect(r.sanPath(r.rootCursor())).toEqual([]);
    expect(r.fenPath(e5)).toEqual([START_FEN, fen, r.fenAt(e5)]);
    expect(r.fenPath(r.rootCursor())).toEqual([START_FEN]);
  });

  it('fenAt throws for a move beyond the segment', () => {
    expect(() => r.fenAt({ nodeId: e4.nodeId, played: 5 })).toThrow(/Bad cursor move/);
  });

  it('fenAt works inside a pinned segment and across a split', () => {
    const p = pinnedOf(['e4', 'e5', 'Nf3']);
    const pr = p.session.repertoire;
    expect(pr.fenAt({ nodeId: p.id, played: 2 })).toBe(r.fenAt(e5));
    const split = cmd.branch(pr, { nodeId: p.id, played: 2 }, 'c4', O, O, false).repertoire;
    const tail = split.node(p.id).children[0] as string;
    expect(split.fenAt({ nodeId: tail, played: 1 })).toBe(pr.fenAt({ nodeId: p.id, played: 3 }));
  });

  it('firstMoveIndex and pinLabel number the first move and count the rest of a segment', () => {
    const p = pinnedOf(['e4', 'e5', 'Nf3']);
    const pr = p.session.repertoire;
    expect(pr.pinLabel(pr.rootId)).toBe('♟');
    expect(pr.pinLabel(p.id)).toBe('1.e4 e5 2.Nf3');
    const long = pinnedOf(['e4', 'e5', 'Nf3', 'Nc6']).session.repertoire;
    expect(long.pinLabel(long.node(long.rootId).children[0] as string)).toBe('1.e4 … 2…Nc6'); // more than 3 moves: first … last
    expect(pr.firstMoveIndex(pr.rootId)).toBe(0);
    expect(r.pinLabel(e5.nodeId)).toBe('1…e5');
    expect(r.firstMoveIndex(e5.nodeId)).toBe(1);
    expect(r.firstMoveIndex(e4.nodeId)).toBe(0);
  });

  it('transpositions find the same position through another move order', () => {
    const t = treeOf({ Nf3: { Nf6: { Nc3: {} } }, Nc3: { Nf6: { Nf3: {} } } });
    const tr = rep(t.map);
    expect(tr.transpositions({ nodeId: t.id('Nf3 Nf6 Nc3'), played: 1 })).toEqual([{ nodeId: t.id('Nc3 Nf6 Nf3'), played: 1 }]);
    expect(tr.transpositions(tr.rootCursor())).toEqual([]);
  });

  it('transpositions also see positions inside pinned segments', () => {
    const p = pinnedOf(['Nf3', 'Nf6', 'Nc3']);
    let s = p.session;
    for (const [i, san] of ['Nc3', 'Nf6', 'Nf3'].entries()) {
      const rp = s.repertoire;
      const parent = i === 0 ? rp.rootCursor() : s.cursor;
      s = s.goTo(parent).play(san, [[5 + i, 5]]).confirmPlacing();
      const child = rp.hasNode(parent.nodeId) ? s.repertoire.node(parent.nodeId).children.at(-1) : undefined;
      s = s.goTo({ nodeId: child as string, played: 1 });
    }
    const here = s.cursor;
    expect(s.repertoire.transpositions(here)).toEqual([{ nodeId: p.id, played: 3 }]);
    expect(s.repertoire.transpositions({ nodeId: p.id, played: 3 })).toEqual([here]);
  });

  it('distancesFrom counts markers up and down the tree', () => {
    const t = treeOf({ e4: { e5: { Nf3: {} } }, d4: {} });
    const tr = rep(t.map);
    const d = tr.distancesFrom(t.id('e4'));
    expect(d.get(t.id('e4'))).toBe(0);
    expect(d.get(tr.rootId)).toBe(1);
    expect(d.get(t.id('e4 e5'))).toBe(1);
    expect(d.get(t.id('d4'))).toBe(2); // sibling via the root
    expect(d.get(t.id('e4 e5 Nf3'))).toBe(2);
    expect(tr.distancesFrom(t.id('e4 e5 Nf3')).get(t.id('d4'))).toBe(4);
  });

  it('branchSize and branchIds cover the node and everything below it', () => {
    const t = treeOf({ e4: { e5: { Nf3: {} }, c5: {} }, d4: {} });
    const tr = rep(t.map);
    expect(tr.branchSize(t.id('e4'))).toBe(4);
    expect(tr.branchSize(t.id('d4'))).toBe(1);
    expect(tr.branchSize(tr.rootId)).toBe(6);
    expect(tr.branchIds(t.id('e4')).sort()).toEqual([t.id('e4'), t.id('e4 e5'), t.id('e4 e5 Nf3'), t.id('e4 c5')].sort());
  });
});

describe('board size', () => {
  it('effectiveBoardZoom sums the size deltas from the root and follows boardZoom', () => {
    const { session, ids } = lineOf(['e4', 'e5']);
    const [root, a, b] = ids as [string, string, string];
    expect(session.repertoire.effectiveBoardZoom(b)).toBe(DEFAULT_BOARD_ZOOM);
    const s = session.resizeBoard(a, 1).resizeBoard(b, -0.5);
    expect(s.repertoire.sizeSum(a)).toBe(1);
    expect(s.repertoire.sizeSum(b)).toBe(0.5);
    expect(s.repertoire.effectiveBoardZoom(a)).toBe(DEFAULT_BOARD_ZOOM - 1);
    expect(s.repertoire.effectiveBoardZoom(b)).toBe(DEFAULT_BOARD_ZOOM - 0.5);
    expect(rep({ ...s.repertoire.data, boardZoom: 3 }).effectiveBoardZoom(root)).toBe(3);
    expect(rep({ ...s.repertoire.data, boardZoom: 3 }).boardZoom).toBe(3);
  });

  it('resize snaps to 0.25 and clears a zero delta (inherit)', () => {
    const { map, ids } = lineOf(['e4']);
    const a = ids[1] as string;
    const r = rep(map);
    expect(cmd.resize(r, a, 0.4).node(a).sizeDelta).toBe(0.5);
    expect('sizeDelta' in cmd.resize(cmd.resize(r, a, 1), a, 0.1).node(a)).toBe(false);
  });

  it('a split tail keeps the same effective board size as the head', () => {
    const { map, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    const r = cmd.branch(cmd.resize(rep(map), id, 1), { nodeId: id, played: 2 }, 'Nc3', [3, 3], [4, 4], false).repertoire;
    const tail = r.node(id).children[0] as string;
    expect(r.node(tail).sizeDelta).toBeUndefined();
    expect(r.effectiveBoardZoom(tail)).toBe(r.effectiveBoardZoom(id));
  });
});

describe('extend (record in place)', () => {
  it('pins a leaf marker and grows its segment', () => {
    const { map, ids } = lineOf(['e4']);
    const r = rep(map);
    const out = cmd.extend(r, r.endOf(ids[1] as string), 'e5');
    expect(out?.cursor).toEqual({ nodeId: ids[1], played: 2 });
    expect(out?.repertoire.node(ids[1] as string)).toMatchObject({ moves: ['e4', 'e5'], pinned: true });
    expect(r.node(ids[1] as string).moves).toEqual(['e4']); // input untouched
  });

  it('refuses the root, a mid-segment cursor and nodes with children', () => {
    const { map, ids } = lineOf(['e4', 'e5']);
    const r = rep(map);
    expect(cmd.extend(r, r.rootCursor(), 'e4')).toBeNull();
    expect(cmd.extend(r, r.endOf(ids[1] as string), 'c5')).toBeNull(); // has a child
    const p = pinnedOf(['e4', 'e5']);
    expect(cmd.extend(p.session.repertoire, { nodeId: p.id, played: 1 }, 'c5')).toBeNull();
  });
});

describe('branch', () => {
  it('adds a child marker, becoming the new lastChild, without touching the input', () => {
    const { map, ids } = lineOf(['e4']);
    const before = JSON.stringify(map);
    const out = cmd.branch(rep(map), rep(map).rootCursor(), 'd4', [9, 9], [9, 9], false);
    expect(JSON.stringify(map)).toBe(before);
    expect(out.cursor).toEqual({ nodeId: out.nodeId, played: 1 });
    const root = out.repertoire.node(map.rootId);
    expect(root.children).toEqual([ids[1], out.nodeId]);
    expect(root.lastChild).toBe(out.nodeId);
    expect(out.repertoire.node(out.nodeId)).toMatchObject({ moves: ['d4'], pinned: false, lngLat: [9, 9] });
  });

  it('reuses an existing child with the same first move', () => {
    const { map, ids } = lineOf(['e4']);
    const out = cmd.branch(rep(map), rep(map).rootCursor(), 'e4', [9, 9], [9, 9], false);
    expect(out.nodeId).toBe(ids[1]);
    expect(out.repertoire.nodes()).toHaveLength(2);
  });

  it('can create the child pinned', () => {
    const empty = emptyRep();
    const out = cmd.branch(empty, empty.rootCursor(), 'e4', O, O, true);
    expect(out.repertoire.node(out.nodeId).pinned).toBe(true);
  });

  it('splits a pinned segment mid-way, re-parenting the old children under the relocated tail', () => {
    const { map, id } = pinnedOf(['e4', 'e5', 'Nf3', 'Nc6']);
    const withChild = cmd.branch(rep(map), rep(map).endOf(id), 'Bb5', [5, 5], [5, 5], false);
    const r = cmd.branch(withChild.repertoire, { nodeId: id, played: 2 }, 'f4', [7, 7], [8, 8], false);
    const head = r.repertoire.node(id);
    expect(head.moves).toEqual(['e4', 'e5']);
    expect(head.children).toHaveLength(2);
    const tail = r.repertoire.node(head.children[0] as string);
    expect(tail).toMatchObject({ moves: ['Nf3', 'Nc6'], pinned: true, lngLat: [8, 8], children: [withChild.nodeId] });
    expect(r.repertoire.node(withChild.nodeId).parentId).toBe(tail.id);
    expect(r.cursor).toEqual({ nodeId: head.children[1], played: 1 });
    expect(r.repertoire.sanPath(r.cursor)).toEqual(['e4', 'e5', 'f4']);
    expect(r.repertoire.sanPath({ nodeId: withChild.nodeId, played: 1 })).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  });

  it('moves the whole tail branch along with the relocated tail', () => {
    const { map, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    const grandchild = cmd.branch(rep(map), rep(map).endOf(id), 'Nc6', [3, 3], [3, 3], false);
    const split = cmd.branch(grandchild.repertoire, { nodeId: id, played: 1 }, 'c5', [7, 7], [13, 23], false).repertoire;
    const tail = split.node(id).children[0] as string;
    expect(split.node(tail).lngLat).toEqual([13, 23]);
    expect(split.node(grandchild.nodeId).lngLat).toEqual([13 + (3 - 1), 23 + (3 - 1)]); // shifted by the same offset
  });

  it('keeps the tail place name', () => {
    const { map, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    const named = cmd.namePlace(rep(map), id, { label: 'Paris' });
    const split = cmd.branch(named, { nodeId: id, played: 1 }, 'c5', O, O, false).repertoire;
    expect(split.node(split.node(id).children[0] as string).place).toEqual({ label: 'Paris' });
  });

  it('does not split when the move already follows the segment', () => {
    const { map, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    const r = rep(map);
    const out = cmd.branch(r, { nodeId: id, played: 1 }, 'e5', O, O, false);
    expect(out.repertoire.data).toEqual(map);
    expect(out.cursor).toEqual({ nodeId: id, played: 2 });
  });

  it('rejects a cursor outside the segment', () => {
    const { map, id } = pinnedOf(['e4', 'e5']);
    expect(() => cmd.branch(rep(map), { nodeId: id, played: 9 }, 'c5', O, O, false)).toThrow(/bad cursor/);
  });
});

describe('moveTo', () => {
  const { map, ids } = lineOf(['e4', 'e5', 'Nf3']);
  const [, e4, e5, nf3] = ids as [string, string, string, string];
  const r = rep(map);

  it('moves a node alone', () => {
    const alone = cmd.moveTo(r, e4, [10, 10], false);
    expect(alone.node(e4).lngLat).toEqual([10, 10]);
    expect(alone.node(e5).lngLat).toEqual([2, 2]);
  });

  it('moves a node with its branch, without touching the input', () => {
    const moved = cmd.moveTo(r, e4, [11, 21], true);
    expect([e4, e5, nf3].map((id) => moved.node(id).lngLat)).toEqual([[11, 21], [12, 22], [13, 23]]);
    expect(r.node(nf3).lngLat).toEqual([3, 3]);
  });
});

describe('annotate / namePlace', () => {
  it('sets a note and removes it when blank', () => {
    const { map, ids } = lineOf(['e4']);
    const id = ids[1] as string;
    const n = cmd.annotate(rep(map), id, 'hi');
    expect(n.node(id).note).toBe('hi');
    expect('note' in cmd.annotate(n, id, '  ').node(id)).toBe(false);
  });

  it('names a place, replacing the previous one', () => {
    const { map, ids } = lineOf(['e4']);
    const id = ids[1] as string;
    const n = cmd.namePlace(cmd.namePlace(rep(map), id, { label: 'Paris', country: 'France' }), id, { label: 'Lyon' });
    expect(n.node(id).place).toEqual({ label: 'Lyon' });
  });
});

describe('remove', () => {
  it('removes the branch and fixes the parent', () => {
    const { map, ids } = lineOf(['e4', 'e5', 'Nf3']);
    const r = cmd.remove(rep(map), ids[2] as string);
    expect(r.nodes()).toHaveLength(2);
    const parent = r.node(ids[1] as string);
    expect(parent.children).toEqual([]);
    expect(parent.lastChild).toBeUndefined();
  });

  it('keeps another lastChild when a sibling goes', () => {
    const t = treeOf({ e4: {}, d4: {}, c4: {} });
    const withLast = patchNode(rep(t.map), t.map.rootId, { lastChild: t.id('e4') });
    const r = cmd.remove(withLast, t.id('d4'));
    expect(r.node(r.rootId).lastChild).toBe(t.id('e4'));
    expect(r.node(r.rootId).children).toEqual([t.id('e4'), t.id('c4')]);
  });

  it('never removes the root', () => {
    expect(() => cmd.remove(emptyRep(), emptyRep().rootId)).toThrow();
    const { map } = lineOf(['e4']);
    expect(() => cmd.remove(rep(map), map.rootId)).toThrow(/root/);
  });
});

describe('map-level commands', () => {
  it('rename, flipped and withView return new repertoires and leave the original alone', () => {
    const r = emptyRep('A', 'white');
    expect(cmd.rename(r, 'B').name).toBe('B');
    expect(cmd.flip(r).orientation).toBe('black');
    expect(cmd.flip(cmd.flip(r)).orientation).toBe('white');
    expect(cmd.withView(r, { center: [1, 2], zoom: 3 }).view).toEqual({ center: [1, 2], zoom: 3 });
    expect(r).toMatchObject({ name: 'A', orientation: 'white', view: undefined });
  });

  it('copy keeps the tree under a fresh id and the given name', () => {
    const { map } = lineOf(['e4']);
    const c = cmd.copyAs(rep(map), 'Twin');
    expect(c.name).toBe('Twin');
    expect(c.id).not.toBe(map.id);
    expect(c.nodes()).toEqual(rep(map).nodes());
  });
});

describe('childOf fixture sanity', () => {
  it('returns the i-th child', () => {
    const t = treeOf({ e4: {}, d4: {} });
    expect(childOf(t.map, t.map.rootId, 1).moves).toEqual(['d4']);
  });
});

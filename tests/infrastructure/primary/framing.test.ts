import { describe, expect, it } from 'vitest';
import { framingPoints } from '../../../src/infrastructure/primary/map/framing';
import { treeOf } from '../../domain/fixtures';

// treeOf places markers at [n, n / 2] degrees in creation order: e4 = [1, .5], e5 = [2, 1], d4 = [3, 1.5].
const { session, id } = treeOf({ e4: { e5: {} }, d4: {} });
const rep = session.repertoire;

describe('framingPoints', () => {
  it('takes the direct children only, not deeper boards', () => {
    expect(framingPoints(rep, rep.rootId, 0, { pinnedNotes: false })).toHaveLength(2);
    expect(framingPoints(rep, id('e4'), 1, { pinnedNotes: false })).toHaveLength(1);
  });

  it('has no children to frame in the middle of a segment', () => {
    expect(framingPoints(rep, id('e4'), 0, { pinnedNotes: false })).toEqual([]);
  });

  it('adds the markers with a pinned note anywhere in the map only when asked', () => {
    const far = session.annotate(id('e4 e5'), 'far away').showNote(id('e4 e5'), true).repertoire;
    expect(framingPoints(far, rep.rootId, 0, { pinnedNotes: false })).toHaveLength(2);
    const withNotes = framingPoints(far, rep.rootId, 0, { pinnedNotes: true });
    expect(withNotes).toHaveLength(3);
    expect(withNotes.filter((p) => p.mx > 20)).toHaveLength(1); // the noted one needs room for its note box
  });

  it('measures offsets from the board, the short way round the globe', () => {
    const [p] = framingPoints(rep, rep.rootId, 0, { pinnedNotes: false });
    expect(p?.dx).toBeCloseTo(1 / 360, 9);
    const wrapped = session.relocate(id('e4'), [179, 0]).relocate(rep.rootId, [-179, 0]).repertoire;
    expect(framingPoints(wrapped, wrapped.rootId, 0, { pinnedNotes: false }).find((q) => Math.abs(q.dx) > 0.001)?.dx).toBeCloseTo(-2 / 360, 9);
  });
});

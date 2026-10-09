import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeMap, canUndoPly, defaultLibrary, deleteMap, exploreMove, forward, getState, init, newMap, playMove,
  setMode, togglePin, undoPly,
} from '../src/store/store';
import { getNode } from '../src/model/types';

const spots: [number, number][] = [[10, 10], [20, 20]];
const root = () => getNode(activeMap(), activeMap().rootId);

beforeEach(() => init(defaultLibrary()));

describe('store', () => {
  it('edit unpinned: spawns children and keeps the cursor', () => {
    setMode('edit');
    playMove('e4', spots);
    playMove('d4', spots);
    expect(root().children).toHaveLength(2);
    expect(getState().cursor.ply).toBe(0);
  });

  it('edit pinned: records a segment and undoes it', () => {
    setMode('edit');
    togglePin();
    for (const s of ['e4', 'e5', 'Nf3']) playMove(s, spots);
    const id = getState().cursor.nodeId;
    expect(getNode(activeMap(), id).plies).toEqual(['e4', 'e5', 'Nf3']);
    expect(canUndoPly()).toBe(true);
    undoPly();
    expect(getNode(activeMap(), id).plies).toEqual(['e4', 'e5']);
    expect(getState().cursor).toEqual({ nodeId: id, ply: 2 });
  });

  it('pinned mid-segment branch splits and advances to the new child', () => {
    setMode('edit');
    togglePin();
    for (const s of ['e4', 'e5', 'Nf3']) playMove(s, spots);
    const id = getState().cursor.nodeId;
    init(getState().library);
    setMode('edit');
    togglePin();
    playMove('e4', spots); // existing -> navigates
    expect(getState().cursor).toEqual({ nodeId: id, ply: 1 });
    playMove('e5', spots);
    expect(getState().cursor).toEqual({ nodeId: id, ply: 2 });
    playMove('c5', spots); // diverges from Nf3 at ply 2
    expect(getNode(activeMap(), id).plies).toEqual(['e4', 'e5']);
    expect(getNode(activeMap(), id).children).toHaveLength(2);
    expect(getNode(activeMap(), getState().cursor.nodeId).plies).toEqual(['c5']);
  });

  it('explore only follows the repertoire', () => {
    setMode('edit');
    playMove('e4', spots);
    setMode('explore');
    expect(exploreMove('d4')).toBe(false);
    expect(exploreMove('e4')).toBe(true);
    expect(getState().cursor.ply).toBe(1);
    expect(forward()).toBe(false);
    expect(getState().pulse).toBe(1);
  });

  it('never deletes the last map', () => {
    expect(deleteMap()).toBe(false);
    newMap('Second', 'black');
    expect(deleteMap()).toBe(true);
    expect(Object.keys(getState().library.maps)).toHaveLength(1);
  });
});

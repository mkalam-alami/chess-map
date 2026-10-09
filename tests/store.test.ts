import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeMap, activeRepertoire, canUndoPly, commitPlacing, defaultLibrary, deleteMap, exploreMove, forward, getState, init, newMap, playMove,
  setMode, togglePin, undoPly,
} from '../src/store/store';

const spots: [number, number][] = [[10, 10], [20, 20]];
const root = () => activeRepertoire().node(activeMap().rootId);
/** Edit mode: a new unpinned move first waits to be placed; this drops it. */
const placeMove = (san: string) => {
  playMove(san, spots);
  commitPlacing();
};

beforeEach(() => init(defaultLibrary()));

describe('store', () => {
  it('edit unpinned: spawns children and keeps the cursor', () => {
    setMode('edit');
    placeMove('e4');
    placeMove('d4');
    expect(root().children).toHaveLength(2);
    expect(getState().cursor.ply).toBe(0);
  });

  it('edit unpinned: a new move waits in placing until it is dropped', () => {
    setMode('edit');
    playMove('e4', spots);
    expect(getState().placing).toMatchObject({ san: 'e4', lngLat: [10, 10], tailLngLat: [20, 20] });
    expect(root().children).toHaveLength(0);
    commitPlacing();
    expect(getState().placing).toBeNull();
    expect(root().children).toHaveLength(1);
  });

  it('edit pinned: records a segment and undoes it', () => {
    setMode('edit');
    togglePin();
    for (const s of ['e4', 'e5', 'Nf3']) playMove(s, spots);
    const id = getState().cursor.nodeId;
    expect(activeRepertoire().node(id).plies).toEqual(['e4', 'e5', 'Nf3']);
    expect(canUndoPly()).toBe(true);
    undoPly();
    expect(activeRepertoire().node(id).plies).toEqual(['e4', 'e5']);
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
    expect(activeRepertoire().node(id).plies).toEqual(['e4', 'e5']);
    expect(activeRepertoire().node(id).children).toHaveLength(2);
    expect(activeRepertoire().node(getState().cursor.nodeId).plies).toEqual(['c5']);
  });

  it('explore only follows the repertoire', () => {
    setMode('edit');
    placeMove('e4');
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

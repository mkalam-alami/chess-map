import type { LngLat, Place } from '../geo';
import { newId } from '../id';
import { Repertoire } from './Repertoire';
import { appendMove, branchAt, deleteSubtree, getNode, moveNode, setNote, setNoteShown, setPinned, setPlace, setSizeDelta, undoLastMove } from './tree';
import type { ChessMapData, Cursor, NodeId, SavedView } from './types';

// Package-private building blocks of `Session` (not in the domain barrel): they only enforce tree integrity, while
// `Session` owns the rules about WHEN they apply (modes, busy flows, spawn positions). Each returns a new Repertoire.

/** Outcome of a command that moves the cursor along with the map. */
export interface Moved { repertoire: Repertoire; cursor: Cursor }

const make = (d: ChessMapData): Repertoire => Repertoire.fromData(d);

export const rename = (r: Repertoire, name: string): Repertoire => make({ ...r.data, name });

export const flip = (r: Repertoire): Repertoire => make({ ...r.data, orientation: r.orientation === 'white' ? 'black' : 'white' });

export const withView = (r: Repertoire, view: SavedView): Repertoire => make({ ...r.data, view });

/** Same tree under a fresh map id and name. */
export const copyAs = (r: Repertoire, name: string): Repertoire => make({ ...r.data, id: newId(), name });

/**
 * Records `san` in place when the cursor is at the end of a non-root leaf: the node becomes pinned
 * and its segment grows. Null when the cursor is elsewhere (then the move needs `branch`).
 */
export function extend(r: Repertoire, cursor: Cursor, san: string): Moved | null {
  const node = r.node(cursor.nodeId);
  if (cursor.played !== node.moves.length || node.parentId === null || node.children.length) return null;
  const pinned = node.pinned ? r.data : setPinned(r.data, node.id, true);
  return { repertoire: make(appendMove(pinned, node.id, san)), cursor: { nodeId: node.id, played: cursor.played + 1 } };
}

/**
 * Plays a new move `san` as a child at `at`, splitting a segment first when the cursor is mid-way
 * (the split-off tail, with its branch, is relocated to `tailAt`). `pinned` makes the new marker a
 * recording segment. `cursor` of the result is on the new marker.
 */
export function branch(r: Repertoire, cursor: Cursor, san: string, at: LngLat, tailAt: LngLat, pinned: boolean): Moved & { nodeId: NodeId } {
  const node = r.node(cursor.nodeId);
  const splits = cursor.played < node.moves.length && node.moves[cursor.played] !== san;
  const res = branchAt(r.data, cursor, san, at);
  let d = res.map;
  if (splits) d = moveNode(d, getNode(d, node.id).children[0] as NodeId, tailAt, { withSubtree: true });
  if (pinned) d = setPinned(d, res.cursor.nodeId, true);
  return { repertoire: make(d), cursor: res.cursor, nodeId: res.cursor.nodeId };
}

/** Drops the last move when `canTakeBack`; otherwise returns `r`. */
export const takeBack = (r: Repertoire, cursor: Cursor): Repertoire =>
  r.canTakeBack(cursor) ? make(undoLastMove(r.data, cursor.nodeId)) : r;

/** Moves a position (and its whole branch with `withBranch`). */
export const moveTo = (r: Repertoire, nodeId: NodeId, at: LngLat, withBranch: boolean): Repertoire =>
  make(moveNode(r.data, nodeId, at, { withSubtree: withBranch }));

/** A blank note removes it. */
export const annotate = (r: Repertoire, nodeId: NodeId, note: string): Repertoire => make(setNote(r.data, nodeId, note));

/** Keeps the note visible under the marker; ignored without a note. */
export const showNote = (r: Repertoire, nodeId: NodeId, shown: boolean): Repertoire => make(setNoteShown(r.data, nodeId, shown));

/** Absolute log2 board size relative to the parent, snapped to 0.25; 0 inherits. */
export const resize = (r: Repertoire, nodeId: NodeId, delta: number): Repertoire => make(setSizeDelta(r.data, nodeId, delta));

export const namePlace = (r: Repertoire, nodeId: NodeId, place: Place): Repertoire => make(setPlace(r.data, nodeId, place));

/** Removes the position and everything after it. Throws for the root. */
export const remove = (r: Repertoire, nodeId: NodeId): Repertoire => make(deleteSubtree(r.data, nodeId));

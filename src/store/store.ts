import { getNode, type ChessMap, type Cursor, type Library, type LngLat, type MapId, type MapNode, type NodeId, type SavedView } from '../model/types';
import {
  appendPly, branchAt, canUndoLastPly, createLibrary, createMap, deleteSubtree, moveNode, pathTo,
  setNote as setNoteOnMap, setPinned, setSizeDelta, setPlace as setPlaceOnMap, undoLastPly,
} from '../model/tree';
import { sizeSum } from '../model/scale';
import { cursorBack, cursorEnd, cursorForward, nextCursor, rootCursor } from '../model/cursor';
import { newId } from '../model/id';
import { exportMap, importMap } from '../model/serialize';
import { DEFAULT_CENTER, wrapLng } from '../geo/lngLat';
import { loadMode, saveLibrary, saveMode } from './persist';

export type Mode = 'explore' | 'edit';

/** A new child move waiting to be dropped somewhere on the map (transient, never persisted). */
export interface Placing { parentCursor: Cursor; san: string; lngLat: LngLat; tailLngLat: LngLat }

/** Set-location flow: `nodeId` is the board / pin being moved (null = plain "go to place"); `preview` the highlighted candidate. */
export interface Relocating { nodeId: NodeId | null; preview: LngLat | null }

export interface State {
  library: Library;
  activeMapId: MapId;
  cursor: Cursor;
  mode: Mode;
  overview: boolean;
  /** Edit mode "recording": moves extend a pinned segment instead of spawning markers. */
  pin: boolean;
  /** Bumped by focus(): the view should ease the map to the cursor node. */
  recenter: number;
  /** The board is shown on the map. Closing it leaves only pins; focus() reopens it. UI-only. */
  boardOpen: boolean;
  /** Centered mode: the map view follows the board (zoom stays on it). Panning the map leaves it; any board switch restores it. UI-only. */
  centered: boolean;
  /** Set with `recenter` by back()/forward(): keep the board's on-screen size instead of fitting the children. */
  keepSize: boolean;
  /** Bumped when forward had nowhere to go: children pins should pulse. */
  pulse: number;
  placing: Placing | null;
  relocating: Relocating | null;
}

/** Integration points for side effects (geocoding, PGN, Lichess), wired in integration.ts. */
export const hooks = {
  /** Called after a node was spawned or dropped at a (wrapped) position. */
  onNodePlaced: (_nodeId: NodeId, _lngLat: LngLat): void => {},
  menu: {} as Partial<Record<'export-pgn' | 'import-pgn' | 'open-lichess', () => void>>,
};

export const defaultLibrary = (): Library => createLibrary(createMap('My repertoire', 'white', DEFAULT_CENTER));

/** Spawned markers stay within +-60 degrees of latitude at root scale (+-80 for rescaled boards). */
const spawnAt = (ll: LngLat, limit: number): LngLat => {
  const w = wrapLng(ll);
  return [w[0], Math.max(-limit, Math.min(limit, w[1]))];
};

/** Patch for showing a map from its start: an empty repertoire has nothing to explore, so it switches to Edit. */
const enterMap = (map: ChessMap) => ({
  cursor: rootCursor(map), pin: false, placing: null, relocating: null, boardOpen: true, centered: true,
  ...(getNode(map, map.rootId).children.length ? {} : { mode: 'edit' as const }),
}) satisfies Partial<State>;

function initial(library: Library): State {
  return {
    library, activeMapId: library.activeMapId, mode: loadMode() ?? 'explore', overview: true, recenter: 0, keepSize: false, pulse: 0,
    ...enterMap(library.maps[library.activeMapId] as ChessMap),
  };
}

let state: State = initial(defaultLibrary());
const listeners = new Set<() => void>();

export const getState = (): State => state;
export const activeMap = (): ChessMap => state.library.maps[state.library.activeMapId] as ChessMap;
export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function notify(): void {
  for (const fn of [...listeners]) fn();
}

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  notify();
}

function commitLibrary(library: Library, patch: Partial<State> = {}): void {
  saveLibrary(library);
  set({ library, activeMapId: library.activeMapId, ...patch });
}

function commit(map: ChessMap, patch: Partial<State> = {}): void {
  commitLibrary({ ...state.library, maps: { ...state.library.maps, [map.id]: map } }, patch);
}

/** Replaces the whole state (app start, tests). */
export function init(library: Library): void {
  state = initial(library);
  notify();
}

/** A transient flow (placing a move, setting a location) owns the input: navigation and mode changes wait. */
const busy = (): boolean => !!(state.placing || state.relocating);

/** Moves the cursor and asks the view to ease the map to it. */
const refocus = (cursor: Cursor, keepSize = false): Partial<State> => ({ cursor, recenter: state.recenter + 1, keepSize, boardOpen: true, centered: true });

// ---- navigation / modes ----

export function focus(cursor: Cursor, keepSize = false): void {
  if (busy()) return;
  getNode(activeMap(), cursor.nodeId);
  set(refocus(cursor, keepSize));
}

/** Enters or leaves centered mode (leaving happens when the user pans the map). */
export function setCentered(centered: boolean): void {
  if (state.centered !== centered) set({ centered });
}

/** Hides the board; every board may be closed, the root included. */
export function closeBoard(): void {
  if (!busy()) set({ boardOpen: false });
}

export function back(): void {
  if (busy()) return;
  const c = cursorBack(activeMap(), state.cursor);
  if (c) focus(c, true);
}

/** Returns false (and pulses the children pins) when there is nowhere to go. */
export function forward(): boolean {
  if (busy()) return false;
  const c = cursorForward(activeMap(), state.cursor);
  if (c) focus(c, true);
  else set({ pulse: state.pulse + 1 });
  return c !== null;
}

export const setMode = (mode: Mode): void => {
  if (busy()) return;
  saveMode(mode);
  set({ mode });
};
export const toggleMode = (): void => setMode(state.mode === 'edit' ? 'explore' : 'edit');
export const togglePin = (): void => set({ pin: !state.pin });
export const toggleOverview = (): void => set({ overview: !state.overview });

// ---- playing moves ----

/** True if playing `san` here would navigate to an existing position instead of creating a child. */
export const moveExists = (san: string): boolean => nextCursor(activeMap(), state.cursor, san) !== null;

/** Training: follows the repertoire. Returns false if `san` is not in it. */
export function exploreMove(san: string): boolean {
  const next = nextCursor(activeMap(), state.cursor, san);
  if (next) focus(next);
  return next !== null;
}

/**
 * Edit-mode move. `spots[0]` is where a new marker goes, `spots[1]` where a
 * split-off tail is relocated (so it doesn't hide under the board).
 */
export function playMove(san: string, spots: LngLat[]): void {
  const map = activeMap();
  const { cursor, pin } = state;
  const existing = nextCursor(map, cursor, san);
  if (existing) {
    set(refocus(existing));
    return;
  }
  const node = getNode(map, cursor.nodeId);
  const atEnd = cursor.ply === node.plies.length;
  if (pin && atEnd && node.parentId !== null && node.children.length === 0) {
    commit(appendPly(node.pinned ? map : setPinned(map, node.id, true), node.id, san), { cursor: { nodeId: node.id, ply: cursor.ply + 1 } });
    return;
  }
  const limit = sizeSum(map, node.id) === 0 ? 60 : 80;
  const spot = spawnAt(spots[0] ?? node.lngLat, limit);
  const r = branchAt(map, cursor, san, spot);
  let next = r.map;
  if (!atEnd) {
    const tailId = getNode(next, node.id).children[0] as NodeId;
    next = moveNode(next, tailId, spawnAt(spots[1] ?? spot, limit), { withSubtree: true });
  }
  const created = r.cursor.nodeId;
  if (pin) commit(setPinned(next, created, true), refocus(r.cursor));
  else commit(next); // cursor stays: the user can keep spawning alternatives
  hooks.onNodePlaced(created, spot);
}

// ---- carry-to-place for new markers ----

const placingListeners = new Set<() => void>();
/** Light-weight notifications for ghost movement (no full re-render). */
export const subscribePlacing = (fn: () => void): void => void placingListeners.add(fn);

export function beginPlacing(san: string, lngLat: LngLat, tailLngLat: LngLat = lngLat): void {
  set({ placing: { parentCursor: state.cursor, san, lngLat, tailLngLat } });
}

export function movePlacing(lngLat: LngLat): void {
  if (!state.placing) return;
  state = { ...state, placing: { ...state.placing, lngLat } };
  for (const f of placingListeners) f();
}

export function commitPlacing(): void {
  const p = state.placing;
  if (!p) return;
  set({ placing: null });
  playMove(p.san, [p.lngLat, p.tailLngLat]);
}

export const cancelPlacing = (): void => {
  if (state.placing) set({ placing: null });
};

/** Only at the end of a leaf segment (see canUndoLastPly). */
export function canUndoPly(): boolean {
  const { cursor } = state;
  const map = activeMap();
  return !state.relocating && cursor.ply === getNode(map, cursor.nodeId).plies.length && canUndoLastPly(map, cursor.nodeId);
}

export function undoPly(): void {
  if (!canUndoPly()) return;
  const { cursor } = state;
  commit(undoLastPly(activeMap(), cursor.nodeId), { cursor: { nodeId: cursor.nodeId, ply: cursor.ply - 1 } });
}

// ---- node edits ----

/** With `place` (e.g. a search result) the label is set directly and no reverse geocoding is triggered. */
export function moveNodeTo(nodeId: NodeId, lngLat: LngLat, withSubtree = false, place?: MapNode['place']): void {
  const at = wrapLng(lngLat);
  const moved = moveNode(activeMap(), nodeId, at, { withSubtree });
  commit(place ? setPlaceOnMap(moved, nodeId, place) : moved);
  if (!place) hooks.onNodePlaced(nodeId, at);
}

/** Absolute log2 board size relative to the parent (snapped to 0.25). */
export const setBoardSize = (nodeId: NodeId, delta: number): void => commit(setSizeDelta(activeMap(), nodeId, delta));

export const setNote = (nodeId: NodeId, note: string): void => commit(setNoteOnMap(activeMap(), nodeId, note));
export const setPlace = (nodeId: NodeId, place: MapNode['place']): void => commit(setPlaceOnMap(activeMap(), nodeId, place));

export function deleteNode(nodeId: NodeId): void {
  const map = activeMap();
  const node = getNode(map, nodeId);
  if (node.parentId === null) return;
  const cursor = pathTo(map, state.cursor.nodeId).includes(nodeId) ? cursorEnd(map, node.parentId) : state.cursor;
  commit(deleteSubtree(map, nodeId).map, { cursor });
}

// ---- set location by city ----

/** Edit mode: `nodeId` = target board / pin; null = plain "go to place" (no relocation). */
export function beginRelocate(nodeId: NodeId | null): void {
  if (state.placing || (nodeId !== null && state.mode !== 'edit')) return;
  if (nodeId !== null) getNode(activeMap(), nodeId);
  set({ relocating: { nodeId, preview: null } });
}
export function previewRelocate(preview: LngLat | null): void {
  if (state.relocating) set({ relocating: { ...state.relocating, preview } });
}
export const endRelocate = (): void => {
  if (state.relocating) set({ relocating: null });
};

// ---- maps ----

export function switchMap(id: MapId): void {
  const map = state.library.maps[id];
  if (map) commitLibrary({ ...state.library, activeMapId: id }, enterMap(map));
}

/** Adds an already validated map (new, duplicated or imported) and switches to it. */
export function addMap(map: ChessMap): void {
  commitLibrary({ ...state.library, maps: { ...state.library.maps, [map.id]: map }, activeMapId: map.id }, enterMap(map));
}

export const newMap = (name: string, orientation: 'white' | 'black', at: LngLat = DEFAULT_CENTER): void =>
  addMap(createMap(name.trim() || 'Untitled', orientation, wrapLng(at)));

export const renameMap = (name: string): void => commit({ ...activeMap(), name: name.trim() || activeMap().name });
export const flipOrientation = (): void =>
  commit({ ...activeMap(), orientation: activeMap().orientation === 'white' ? 'black' : 'white' });

export function duplicateMap(): void {
  const src = activeMap();
  addMap({ ...src, id: newId(), name: `${src.name} (copy)` });
}

/** Never deletes the last map. */
export function deleteMap(id: MapId = state.library.activeMapId): boolean {
  if (Object.keys(state.library.maps).length <= 1 || !state.library.maps[id]) return false;
  const { [id]: _gone, ...maps } = state.library.maps;
  const activeMapId = id === state.library.activeMapId ? (Object.keys(maps)[0] as MapId) : state.library.activeMapId;
  commitLibrary({ ...state.library, maps, activeMapId }, enterMap(maps[activeMapId] as ChessMap));
  return true;
}

export const exportActiveMapJson = (): string => exportMap(activeMap());

/** Adds the imported map as a new map and switches to it. Throws ValidationError on bad input. */
export function importMapJson(text: string): ChessMap {
  const map = importMap(text);
  addMap(map);
  return map;
}

/** Remembers the viewport without re-rendering. */
export function saveView(view: SavedView): void {
  const map = activeMap();
  const library = { ...state.library, maps: { ...state.library.maps, [map.id]: { ...map, view } } };
  state = { ...state, library };
  saveLibrary(library);
}

import {
  DEFAULT_CENTER, Library, Repertoire, Session,
  type ChessMapData, type Cursor, type LibraryData, type LngLat, type MapId, type Mode, type NodeId, type Orientation, type Place,
  type Placing, type Relocating, type SavedView,
} from '../domain';
import { exportMap, importMap } from '../model/serialize';
import { loadMode, saveLibrary, saveMode } from './persist';

export type { Mode, Placing, Relocating };

/** Presentation-only state: not part of the domain session, never persisted. */
interface Ui {
  overview: boolean;
  /** Bumped by every focus: the view should ease the map to the cursor node. */
  recenter: number;
  /** The board is shown on the map. Closing it leaves only pins; focusing reopens it. */
  boardOpen: boolean;
  /** Centered mode: the map view follows the board (zoom stays on it). Panning the map leaves it; any board switch restores it. */
  centered: boolean;
  /** Set with `recenter` by back()/forward(): keep the board's on-screen size instead of fitting the children. */
  keepSize: boolean;
  /** Bumped when forward had nowhere to go: children pins should pulse. */
  pulse: number;
}

/** Read model of the store: the UI state plus the session projected into plain fields. */
export interface State extends Ui {
  session: Session;
  library: LibraryData;
  activeMapId: MapId;
  cursor: Cursor;
  mode: Mode;
  /** Edit mode "recording": moves extend a pinned segment instead of spawning markers. */
  pin: boolean;
  placing: Placing | null;
  relocating: Relocating | null;
}

/** Integration points for side effects (geocoding, PGN, Lichess), wired in integration.ts. */
export const hooks = {
  /** Called after a node was spawned or dropped at a (wrapped) position. */
  onNodePlaced: (_nodeId: NodeId, _lngLat: LngLat): void => {},
  menu: {} as Partial<Record<'export-pgn' | 'import-pgn' | 'open-lichess', () => void>>,
};

export const defaultLibrary = (): LibraryData => Library.initial().data;

const initialUi = (): Ui => ({ overview: true, recenter: 0, boardOpen: true, centered: true, keepSize: false, pulse: 0 });

const project = (session: Session, ui: Ui): State => ({
  ...ui,
  session,
  library: session.library.data,
  activeMapId: session.library.activeId,
  cursor: session.cursor,
  mode: session.mode,
  pin: session.recording,
  placing: session.placing,
  relocating: session.relocating,
});

let session = Session.empty(loadMode());
let state: State = project(session, initialUi());
const listeners = new Set<() => void>();

export const getState = (): State => state;
/** The active map as a read-only domain model (queries for views). */
export const activeRepertoire = (): Repertoire => session.repertoire;
/** The active map's plain data. */
export const activeMap = (): ChessMapData => session.repertoire.data;
export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function notify(): void {
  for (const fn of [...listeners]) fn();
}

function set(patch: Partial<Ui>): void {
  state = { ...state, ...patch };
  notify();
}

/** Presentation patch for the events of an action (what views must do in response). */
function uiFor(ui: Ui, session: Session): Ui {
  let out = ui;
  for (const e of session.events) {
    if (e.type === 'focused') out = { ...out, recenter: out.recenter + 1, keepSize: e.keepSize, boardOpen: true, centered: true };
    else if (e.type === 'deadEnd') out = { ...out, pulse: out.pulse + 1 };
    else if (e.type === 'mapEntered') out = { ...out, boardOpen: true, centered: true };
  }
  return out;
}

/** Replaces the session: saves a changed library, translates events into UI patches, notifies, then runs side-effect events. */
function apply(next: Session, notifyViews = true): Session {
  if (next === session) return next;
  if (next.library !== session.library) saveLibrary(next.library.data);
  session = next;
  state = project(next, uiFor(state, next));
  if (notifyViews) notify();
  for (const e of next.events) if (e.type === 'positionPlaced') hooks.onNodePlaced(e.nodeId, e.at);
  return next;
}

/** Replaces the whole state (app start, tests). */
export function init(library: LibraryData): void {
  session = Session.start(Library.fromData(library), loadMode());
  state = project(session, initialUi());
  notify();
}

// ---- navigation / modes ----

export function focus(cursor: Cursor, keepSize = false): void {
  apply(session.goTo(cursor, { keepSize }));
}

/** Enters or leaves centered mode (leaving happens when the user pans the map). */
export function setCentered(centered: boolean): void {
  if (state.centered !== centered) set({ centered });
}

/** Hides the board; every board may be closed, the root included. */
export function closeBoard(): void {
  if (!session.busy) set({ boardOpen: false });
}

export const back = (): void => void apply(session.back());

/** Returns false (and pulses the children pins) when there is nowhere to go. */
export function forward(): boolean {
  const next = apply(session.forward());
  return next.events.some((e) => e.type === 'focused');
}

export function setMode(mode: Mode): void {
  const before = session.mode;
  apply(session.switchMode(mode));
  if (session.mode !== before) saveMode(session.mode);
}
export const toggleMode = (): void => setMode(session.mode === 'edit' ? 'explore' : 'edit');
export const togglePin = (): void => void apply(session.toggleRecording());
export const toggleOverview = (): void => set({ overview: !state.overview });

// ---- playing moves ----

/** True if playing `san` here would navigate to an existing position instead of creating a child. */
export const moveExists = (san: string): boolean => session.moveExists(san);

/** Plays `san` per the current mode (see `Session.play`). Returns false when Explore rejects it. */
export function playMove(san: string, spots: LngLat[] = []): boolean {
  return !apply(session.play(san, spots)).events.some((e) => e.type === 'rejected');
}

/** Training: follows the repertoire. Returns false if `san` is not in it. */
export const exploreMove = (san: string): boolean => playMove(san);

// ---- carry-to-place for new markers ----

const placingListeners = new Set<() => void>();
/** Light-weight notifications for ghost movement (no full re-render). */
export const subscribePlacing = (fn: () => void): void => void placingListeners.add(fn);

export function movePlacing(lngLat: LngLat): void {
  if (!session.placing) return;
  apply(session.movePlacing(lngLat), false);
  for (const f of placingListeners) f();
}

export const commitPlacing = (): void => void apply(session.confirmPlacing());
export const cancelPlacing = (): void => void apply(session.cancelPlacing());

/** Only at the end of a leaf segment (see Repertoire.canTakeBack). */
export const canUndoPly = (): boolean => session.canTakeBack;
export const undoPly = (): void => void apply(session.takeBack());

// ---- node edits ----

/** With `place` (e.g. a search result) the label is set directly and no reverse geocoding is triggered. */
export function moveNodeTo(nodeId: NodeId, lngLat: LngLat, withSubtree = false, place?: Place): void {
  apply(session.relocate(nodeId, lngLat, { withBranch: withSubtree, ...(place ? { place } : {}) }));
}

/** Absolute log2 board size relative to the parent (snapped to 0.25). */
export const setBoardSize = (nodeId: NodeId, delta: number): void => void apply(session.resizeBoard(nodeId, delta));

export const setNote = (nodeId: NodeId, note: string): void => void apply(session.annotate(nodeId, note));
/** Names a position; with `requestedAt` it is ignored when the node has moved since that lookup. */
export const setPlace = (nodeId: NodeId, place: Place, requestedAt?: LngLat): void => void apply(session.nameLocation(nodeId, place, requestedAt));

export const deleteNode = (nodeId: NodeId): void => void apply(session.deletePosition(nodeId));

// ---- set location by city ----

/** Edit mode: `nodeId` = target board / pin; null = plain "go to place" (no relocation). */
export const beginRelocate = (nodeId: NodeId | null): void => void apply(session.startRelocating(nodeId));
export const previewRelocate = (preview: LngLat | null): void => void apply(session.previewRelocation(preview));
export const endRelocate = (): void => void apply(session.endRelocating());

// ---- maps ----

export const switchMap = (id: MapId): void => void apply(session.switchMap(id));

/** Adds an already validated map (new, duplicated or imported) and switches to it. */
export const addMap = (map: ChessMapData): void => void apply(session.addMaps([Repertoire.fromData(map)]));

export const newMap = (name: string, orientation: Orientation, at: LngLat = DEFAULT_CENTER): void =>
  void apply(session.createMap(name, orientation, at));

export const renameMap = (name: string): void => void apply(session.renameMap(name));
export const flipOrientation = (): void => void apply(session.flipOrientation());
export const duplicateMap = (): void => void apply(session.duplicateMap());

/** Never deletes the last map. */
export function deleteMap(id: MapId = session.library.activeId): boolean {
  const before = session;
  apply(session.deleteMap(id));
  return session !== before;
}

export const exportActiveMapJson = (): string => exportMap(activeMap());

/** Adds the imported map as a new map and switches to it. Throws ValidationError on bad input. */
export function importMapJson(text: string): ChessMapData {
  const map = importMap(text);
  addMap(map);
  return map;
}

/** Remembers the viewport without re-rendering. */
export function saveView(view: SavedView): void {
  apply(session.rememberView(view), false);
}

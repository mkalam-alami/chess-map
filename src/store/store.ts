// TEMPORARY (phase 3 removes this): a thin facade over one ChessMapApp so src/map and src/ui keep working unchanged
// until they are migrated to talk to the application layer directly. Only presentation-only state lives here.
import { DEFAULT_CENTER, type ChessMapData, type Cursor, type LibraryData, type LngLat, type MapId, type Mode, type NodeId, type OpeningInfo, type Orientation, type Place, type Placing, type Relocating, type Repertoire, type SavedView, type Session } from '../domain';
import { ChessMapApp, type MapFormatId } from '../application';
import { JsonMapFormat } from '../infrastructure/secondary/formats/JsonMapFormat';
import { PgnMapFormat } from '../infrastructure/secondary/formats/PgnMapFormat';
import { NominatimReverseGeocoder } from '../infrastructure/secondary/geocoding/NominatimReverseGeocoder';
import { PhotonPlaceSearch } from '../infrastructure/secondary/geocoding/PhotonPlaceSearch';
import { LichessAnalysisBoard } from '../infrastructure/secondary/lichess/LichessAnalysisBoard';
import { LichessOpeningBook } from '../infrastructure/secondary/openings/LichessOpeningBook';
import { DownloadFileSaver } from '../infrastructure/secondary/browser/DownloadFileSaver';
import { LocalStorageLibraryRepository } from '../infrastructure/secondary/storage/LocalStorageLibraryRepository';
import { LocalStoragePreferences } from '../infrastructure/secondary/storage/LocalStoragePreferences';
import { browserStorage } from '../infrastructure/secondary/storage/kv';

export type { Mode, Placing, Relocating };

const pgn = new PgnMapFormat();
const storage = browserStorage();

/** The one application instance (adapters wired here until the composition root takes over in phase 3). */
export const app = new ChessMapApp({
  library: new LocalStorageLibraryRepository(storage),
  preferences: new LocalStoragePreferences(storage),
  geocoder: new NominatimReverseGeocoder(),
  placeSearch: new PhotonPlaceSearch(),
  openings: new LichessOpeningBook(),
  formats: { json: new JsonMapFormat(), pgn },
  files: new DownloadFileSaver(),
  analysis: new LichessAnalysisBoard({
    open: (url) => void window.open(url, '_blank', 'noopener'),
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    writePgn: (map) => pgn.write(map),
  }),
});

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

/** Read model: the UI state plus the session projected into plain fields. */
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

/** Integration points for menu items, wired in integration.ts. */
export const hooks = {
  menu: {} as Partial<Record<'export-pgn' | 'import-pgn' | 'open-lichess', () => void>>,
};

let ui: Ui = { overview: true, recenter: 0, boardOpen: true, centered: true, keepSize: false, pulse: 0 };
let cached: { session: Session; ui: Ui; state: State } | undefined;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const fn of [...listeners]) fn();
};
const setUi = (patch: Partial<Ui>): void => {
  ui = { ...ui, ...patch };
  notify();
};

// Presentation patches for the events of an action; they run before the app notifies, so views see them.
app.on('focused', (e) => void (ui = { ...ui, recenter: ui.recenter + 1, keepSize: e.keepSize, boardOpen: true, centered: true }));
app.on('deadEnd', () => void (ui = { ...ui, pulse: ui.pulse + 1 }));
app.on('mapEntered', () => void (ui = { ...ui, boardOpen: true, centered: true }));
app.subscribe(notify);

/** Rebuilt only when the session or the UI state changed, so it is stable between reads. */
export function getState(): State {
  const session = app.session;
  if (cached?.session !== session || cached.ui !== ui) {
    cached = {
      session, ui,
      state: {
        ...ui, session, library: session.library.data, activeMapId: session.library.activeId, cursor: session.cursor, mode: session.mode,
        pin: session.recording, placing: session.placing, relocating: session.relocating,
      },
    };
  }
  return cached.state;
}

export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const subscribePlacing = (fn: () => void): void => void app.subscribePlacing(fn);

/** The active map as a read-only domain model (queries for views). */
export const activeRepertoire = (): Repertoire => app.session.repertoire;
/** The active map's plain data. */
export const activeMap = (): ChessMapData => app.session.repertoire.data;
export const openingAt = (cursor: Cursor): OpeningInfo | null => app.openingAt(cursor);

// ---- presentation ----

/** Enters or leaves centered mode (leaving happens when the user pans the map). */
export function setCentered(centered: boolean): void {
  if (ui.centered !== centered) setUi({ centered });
}

/** Hides the board; every board may be closed, the root included. */
export function closeBoard(): void {
  if (!app.session.busy) setUi({ boardOpen: false });
}

export const toggleOverview = (): void => setUi({ overview: !ui.overview });

// ---- app actions ----

export const focus = (cursor: Cursor, keepSize = false): void => app.goTo(cursor, { keepSize });
export const back = (): void => app.back();
export const forward = (): boolean => app.forward();
export const setMode = (mode: Mode): void => app.switchMode(mode);
export const toggleMode = (): void => app.toggleMode();
export const togglePin = (): void => app.toggleRecording();
export const playMove = (san: string, spots: LngLat[] = []): boolean => app.play(san, spots);
export const movePlacing = (at: LngLat): void => app.movePlacing(at);
export const commitPlacing = (): void => app.confirmPlacing();
export const cancelPlacing = (): void => app.cancelPlacing();
export const canUndoPly = (): boolean => app.session.canTakeBack;
export const undoPly = (): void => app.takeBack();
export const moveNodeTo = (nodeId: NodeId, at: LngLat, withBranch = false, place?: Place): void =>
  app.relocate(nodeId, at, { withBranch, ...(place ? { place } : {}) });
export const setBoardSize = (nodeId: NodeId, delta: number): void => app.resizeBoard(nodeId, delta);
export const setNote = (nodeId: NodeId, note: string): void => app.annotate(nodeId, note);
export const deleteNode = (nodeId: NodeId): void => app.deletePosition(nodeId);
export const beginRelocate = (nodeId: NodeId | null): void => app.startRelocating(nodeId);
export const previewRelocate = (at: LngLat | null): void => app.previewRelocation(at);
export const endRelocate = (): void => app.endRelocating();
export const switchMap = (id: MapId): void => app.switchMap(id);
export const newMap = (name: string, orientation: Orientation, at: LngLat = DEFAULT_CENTER): void => app.createMap(name, orientation, at);
export const renameMap = (name: string): void => app.renameMap(name);
export const flipOrientation = (): void => app.flipOrientation();
export const duplicateMap = (): void => app.duplicateMap();
export const deleteMap = (id?: MapId): boolean => app.deleteMap(id);
export const saveView = (view: SavedView): void => app.rememberView(view);
export const searchPlaces = (query: string, signal?: AbortSignal) => app.searchPlaces(query, signal);
export const exportMap = (format: MapFormatId): void => app.exportMap(format);
export const importMaps = (format: MapFormatId, text: string, ctx: { name: string; origin: LngLat }): number => app.importMaps(format, text, ctx);

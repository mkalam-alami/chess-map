import {
  Library, Session, openingAt as findOpening,
  type BoardShape, type Cursor, type DomainEvent, type LngLat, type MapId, type Mode, type NodeId, type OpeningInfo, type Orientation, type Place,
  type SavedView,
} from '../domain';
import type {
  AnalysisBoard, FileSaver, LibraryRepository, MapFormat, MapFormatId, OpeningBook, PlaceHit, PlaceSearch, PreferenceStore, ReverseGeocoder,
} from './ports';

/** Everything the application needs from the outside world (constructor injection). */
export interface ChessMapPorts {
  library: LibraryRepository;
  preferences: PreferenceStore;
  geocoder: ReverseGeocoder;
  placeSearch: PlaceSearch;
  openings: OpeningBook;
  formats: Record<MapFormatId, MapFormat>;
  files: FileSaver;
  analysis: AnalysisBoard;
}

/** The domain events views react to (`positionPlaced` is handled here: it triggers reverse geocoding). */
export type ViewEvent = Exclude<DomainEvent, { type: 'positionPlaced' }>;
export type ViewEventType = ViewEvent['type'];

/** Undo steps kept in memory. */
const MAX_HISTORY = 100;

type Listener = () => void;

/** Placeholder label for a position the geocoder knows nothing about. */
const OPEN_SEA: Place = { label: 'Open sea' };

/**
 * The use cases of Chess Map and the only object primary adapters talk to. Owns the current `Session`:
 * every action goes through `apply`, which saves what changed, runs the side-effect events and notifies views.
 */
export class ChessMapApp {
  private current: Session = Session.empty();
  private readonly subscribers = new Set<Listener>();
  private readonly placingSubscribers = new Set<Listener>();
  private readonly listeners = new Map<ViewEventType, Set<(e: never) => void>>();
  /** Libraries before / after the current one, for undo / redo. Kept for this page session only (never persisted). */
  private undoStack: Library[] = [];
  private redoStack: Library[] = [];
  /** Latest reverse-geocoding lookup per node. */
  private readonly lookups = new Map<NodeId, AbortController>();

  constructor(private readonly ports: ChessMapPorts) {}

  // ---- state ----

  get session(): Session { return this.current; }

  /** Called after every state change (not for ghost movement or remembered views, see `subscribePlacing` / `rememberView`). */
  subscribe(fn: Listener): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Light-weight channel for the ghost of a move being placed: no full re-render. */
  subscribePlacing(fn: Listener): () => void {
    this.placingSubscribers.add(fn);
    return () => this.placingSubscribers.delete(fn);
  }

  /** Domain events for views (easing the map, pulsing pins, a rejected move, a map entered). Runs before `subscribe` listeners. */
  on<T extends ViewEventType>(type: T, fn: (event: Extract<ViewEvent, { type: T }>) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, set);
    set.add(fn as (e: never) => void);
    return () => set.delete(fn as (e: never) => void);
  }

  // ---- lifecycle ----

  /**
   * Loads the stored library (or starts the initial one) and the preferred mode, then loads the opening book in the
   * background and notifies subscribers so names appear. An unnamed root is reverse-geocoded.
   * The returned promise settles once the opening book has loaded (or failed to).
   */
  start(): Promise<void> {
    const library = this.ports.library.load() ?? Library.initial();
    this.current = Session.start(library, this.ports.preferences.loadMode());
    this.notify();
    const root = this.current.repertoire.node(this.current.repertoire.rootId);
    if (!root.place) void this.geocode(root.id, root.lngLat);
    return this.ports.openings.load().then(
      () => this.notify(),
      () => { /* no opening names: everything else works */ },
    );
  }

  /** Writes the pending autosave now (page is closing). */
  flush(): void {
    this.ports.library.flush();
  }

  // ---- navigation / modes ----

  goTo(cursor: Cursor, opts: { keepSize?: boolean } = {}): void {
    this.apply(this.current.goTo(cursor, opts));
  }

  back(): void {
    this.apply(this.current.back());
  }

  /** False (and a `deadEnd` event) when there is nowhere to go. */
  forward(): boolean {
    return this.apply(this.current.forward()).events.some((e) => e.type === 'focused');
  }

  /** Remembers the mode as the preference when it changes. */
  switchMode(mode: Mode): void {
    this.apply(this.current.switchMode(mode), { remember: true });
  }

  toggleMode(): void {
    this.apply(this.current.toggleMode(), { remember: true });
  }

  toggleRecording(): void {
    this.apply(this.current.toggleRecording());
  }

  // ---- moves ----

  /** See `Session.play`. False when Explore rejects the move. */
  play(san: string, spots: LngLat[] = []): boolean {
    return !this.apply(this.current.play(san, spots)).events.some((e) => e.type === 'rejected');
  }

  /** Confirmed `extractAsked`: merges the move into the board at `cursor`. */
  extractMove(cursor: Cursor, san: string): void {
    this.apply(this.current.extractMove(cursor, san));
  }

  /** Moves the ghost of the move being placed; only `subscribePlacing` listeners hear about it. */
  movePlacing(at: LngLat): void {
    if (!this.current.placing) return;
    this.apply(this.current.movePlacing(at), { notify: false });
    for (const fn of [...this.placingSubscribers]) fn();
  }

  confirmPlacing(): void {
    this.apply(this.current.confirmPlacing());
  }

  cancelPlacing(): void {
    this.apply(this.current.cancelPlacing());
  }

  takeBack(): void {
    this.apply(this.current.takeBack());
  }

  // ---- history ----

  get canUndo(): boolean { return !this.current.busy && this.undoStack.length > 0; }
  get canRedo(): boolean { return !this.current.busy && this.redoStack.length > 0; }

  /** Reverts the last change to the library (a move, a relocation, a deleted position…). */
  undo(): void {
    const previous = this.undoStack.at(-1);
    if (!previous || this.current.busy) return;
    this.undoStack.pop();
    this.redoStack.push(this.current.library);
    this.apply(this.current.restoreLibrary(previous), { history: false });
  }

  redo(): void {
    const next = this.redoStack.at(-1);
    if (!next || this.current.busy) return;
    this.redoStack.pop();
    this.undoStack.push(this.current.library);
    this.apply(this.current.restoreLibrary(next), { history: false });
  }

  // ---- positions ----

  /** With a `place` (e.g. a search result) the label is set directly and no reverse geocoding happens. */
  relocate(nodeId: NodeId, at: LngLat, opts: { withBranch?: boolean; place?: Place } = {}): void {
    this.apply(this.current.relocate(nodeId, at, opts));
  }

  annotate(nodeId: NodeId, note: string): void {
    this.apply(this.current.annotate(nodeId, note));
  }

  /** Saves the annotations of the board at `cursor` (see `Session.drawShapes`). */
  drawShapes(cursor: Cursor, shapes: BoardShape[]): void {
    this.apply(this.current.drawShapes(cursor, shapes));
  }

  showNote(nodeId: NodeId, shown: boolean): void {
    this.apply(this.current.showNote(nodeId, shown));
  }

  resizeBoard(nodeId: NodeId, delta: number): void {
    this.apply(this.current.resizeBoard(nodeId, delta));
  }

  deletePosition(nodeId: NodeId): void {
    this.apply(this.current.deletePosition(nodeId));
  }

  // ---- set-location flow ----

  startRelocating(nodeId: NodeId | null): void {
    this.apply(this.current.startRelocating(nodeId));
  }

  previewRelocation(at: LngLat | null): void {
    this.apply(this.current.previewRelocation(at));
  }

  endRelocating(): void {
    this.apply(this.current.endRelocating());
  }

  // ---- maps ----

  createMap(name: string, orientation: Orientation, at?: LngLat): void {
    this.apply(this.current.createMap(name, orientation, at));
  }

  switchMap(id: MapId): void {
    this.apply(this.current.switchMap(id));
  }

  renameMap(name: string): void {
    this.apply(this.current.renameMap(name));
  }

  flipOrientation(): void {
    this.apply(this.current.flipOrientation());
  }

  duplicateMap(): void {
    this.apply(this.current.duplicateMap());
  }

  /** False when refused (the last map can't be deleted). */
  deleteMap(id?: MapId): boolean {
    const before = this.current;
    this.apply(this.current.deleteMap(id));
    return this.current !== before;
  }

  /** Remembers the viewport: saved, but nobody is notified (the view already shows it). */
  rememberView(view: SavedView): void {
    this.apply(this.current.rememberView(view), { notify: false, history: false });
  }

  // ---- integrations ----

  /** The deepest named opening on the line to `cursor` (default: the current one); null until the book has loaded. */
  openingAt(cursor: Cursor = this.current.cursor): OpeningInfo | null {
    return findOpening(this.current.repertoire.fenPath(cursor), (epd) => this.ports.openings.lookup(epd));
  }

  /** Place suggestions for a search box. */
  searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
    return this.ports.placeSearch.search(query, signal);
  }

  /** Saves the active map as a file. */
  exportMap(format: MapFormatId): void {
    const f = this.ports.formats[format];
    const map = this.current.repertoire;
    this.ports.files.save(`${map.name}.${f.extension}`, f.write(map), f.mimeType);
  }

  /** Adds the maps in `text` and switches to the last one; returns how many there were. Throws ImportError, leaving the state untouched. */
  importMaps(format: MapFormatId, text: string, ctx: { name: string; origin: LngLat }): number {
    const maps = this.ports.formats[format].read(text, ctx);
    this.apply(this.current.addMaps(maps));
    return maps.length;
  }

  /** Opens the current position in an analysis board; rejects when the clipboard is needed and fails. */
  openInAnalysis(): Promise<'opened' | 'copied'> {
    return this.ports.analysis.open(this.current.repertoire, this.current.cursor);
  }

  // ---- internals ----

  private notify(): void {
    for (const fn of [...this.subscribers]) fn();
  }

  /**
   * Replaces the session. Saves a changed library; saves the mode only for explicit mode actions (`remember`), so a map
   * that is forced into Edit because it is empty does not overwrite the preference. Then it dispatches the events
   * and notifies subscribers (unless `notify` is false). A refused action (same session) does nothing.
   * A changed library is pushed on the undo stack (and forgets the redo stack) unless `history` is false: background
   * updates (geocoded names, the remembered viewport) and undo / redo themselves are not undoable steps.
   */
  private apply(next: Session, opts: { notify?: boolean; remember?: boolean; history?: boolean } = {}): Session {
    const prev = this.current;
    if (next === prev) return next;
    this.current = next;
    if (opts.history !== false && next.library !== prev.library) {
      this.undoStack.push(prev.library);
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    }
    if (next.library !== prev.library) this.ports.library.save(next.library);
    if (opts.remember && next.mode !== prev.mode) this.ports.preferences.saveMode(next.mode);
    for (const e of next.events) this.dispatch(e);
    if (opts.notify !== false) this.notify();
    return next;
  }

  private dispatch(e: DomainEvent): void {
    if (e.type === 'positionPlaced') {
      void this.geocode(e.nodeId, e.at);
      return;
    }
    for (const fn of [...(this.listeners.get(e.type) ?? [])]) (fn as (event: ViewEvent) => void)(e);
  }

  /** Names a position. The latest lookup per node wins; failures leave the place empty. */
  private async geocode(nodeId: NodeId, at: LngLat): Promise<void> {
    this.lookups.get(nodeId)?.abort();
    const ctl = new AbortController();
    this.lookups.set(nodeId, ctl);
    let place: Place | null;
    try {
      place = await this.ports.geocoder.placeAt(at, ctl.signal);
    } catch {
      return; // offline, rate limited, aborted: leave the place empty
    } finally {
      if (this.lookups.get(nodeId) === ctl) this.lookups.delete(nodeId);
    }
    // The domain drops the result if the node was removed or moved while the lookup was in flight.
    if (!ctl.signal.aborted) this.apply(this.current.nameLocation(nodeId, place ?? OPEN_SEA, at), { history: false });
  }
}

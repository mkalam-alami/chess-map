import { DEFAULT_CENTER, sameLngLat, wrapLng, type LngLat, type Place } from '../geo';
import { Library } from '../library/Library';
import { activateMap, addMap, removeMap, replaceMap } from '../library/commands';
import { Repertoire } from '../repertoire/Repertoire';
import * as edit from '../repertoire/commands';
import { sameCursor } from '../repertoire/cursor';
import { SHAPE_BRUSHES, type BoardShape, type Cursor, type MapId, type Mode, type NodeId, type Orientation, type SavedView } from '../repertoire/types';
import type { DomainEvent } from './events';

/** A new move waiting to be dropped somewhere on the map (transient, never persisted). */
export interface Placing { parentCursor: Cursor; san: string; lngLat: LngLat; tailLngLat: LngLat }

/** Set-location flow: `nodeId` is the board / pin being moved (null = plain "go to place"); `preview` the highlighted candidate. */
export interface Relocating { nodeId: NodeId | null; preview: LngLat | null }

interface Fields {
  library: Library;
  cursor: Cursor;
  future: Cursor[];
  mode: Mode;
  recording: boolean;
  placing: Placing | null;
  relocating: Relocating | null;
  events: DomainEvent[];
}

const SQUARE = /^[a-h][1-8]$/;
const isShape = (s: BoardShape): boolean => SQUARE.test(s.orig) && (s.dest === undefined || SQUARE.test(s.dest)) && SHAPE_BRUSHES.includes(s.brush);

/** Spawned markers stay within +-60 degrees of latitude at root scale (+-80 for rescaled boards). */
const spawnAt = (ll: LngLat, limit: number): LngLat => {
  const w = wrapLng(ll);
  return [w[0], Math.max(-limit, Math.min(limit, w[1]))];
};

/**
 * The user's working session and aggregate root of the domain: every user action goes through here.
 *
 * Immutable: each action returns a new Session whose `events` say what the outside world should do
 * (focus the map, geocode a position…). A refused action returns `this` with no events, so callers can
 * detect it with `===`. The only exceptions are actions that report something without changing state
 * (`forward` at a dead end, `play` of a rejected Explore move): they return a copy carrying the event.
 */
export class Session {
  readonly library: Library;
  readonly cursor: Cursor;
  /**
   * The moves ahead that `forward` walks through, nearest first. Only a step back (key, marker or line click)
   * fills it, and any move played empties it: no future line is ever picked by default.
   */
  readonly future: Cursor[];
  readonly mode: Mode;
  /** Edit mode "recording" (the old "pin" toggle): moves extend a pinned segment instead of spawning markers. */
  readonly recording: boolean;
  readonly placing: Placing | null;
  readonly relocating: Relocating | null;
  /** Produced by the action that created this session (empty for a fresh start). */
  readonly events: DomainEvent[];

  private constructor(f: Fields) {
    this.library = f.library;
    this.cursor = f.cursor;
    this.future = f.future;
    this.mode = f.mode;
    this.recording = f.recording;
    this.placing = f.placing;
    this.relocating = f.relocating;
    this.events = f.events;
  }

  // ---- construction ----

  /** Opens `library` on its active map. An empty repertoire has nothing to explore, so it forces Edit. */
  static start(library: Library, preferredMode: Mode | null = null): Session {
    return Session.entered(library, preferredMode ?? 'explore', []);
  }

  /** A first-time session: the initial library, in Edit because it is empty (unless a mode was remembered and the map has moves). */
  static empty(preferredMode: Mode | null = null): Session {
    return Session.start(Library.initial(), preferredMode);
  }

  /** Showing a map from its start: cursor at the root, flows reset. */
  private static entered(library: Library, mode: Mode, events: DomainEvent[]): Session {
    const rep = library.active;
    const empty = rep.node(rep.rootId).children.length === 0;
    return new Session({
      library, cursor: rep.rootCursor(), future: [], mode: empty ? 'edit' : mode, recording: false, placing: null, relocating: null, events,
    });
  }

  private next(patch: Partial<Fields> = {}, events: DomainEvent[] = []): Session {
    const reset = patch.cursor && !patch.future ? { future: [] } : {}; // a new cursor forgets the future unless told otherwise
    return new Session({ ...this, ...reset, ...patch, events });
  }

  private commit(repertoire: Repertoire, patch: Partial<Fields> = {}, events: DomainEvent[] = []): Session {
    return this.next({ library: replaceMap(this.library, repertoire), ...patch }, events);
  }

  // ---- queries ----

  /** The active map. */
  get repertoire(): Repertoire { return this.library.active; }

  /** A transient flow (placing a move, setting a location) owns the input: navigation and mode changes wait. */
  get busy(): boolean { return this.placing !== null || this.relocating !== null; }

  /** True if playing `san` here would navigate to an existing position instead of creating one. */
  moveExists(san: string): boolean { return this.repertoire.next(this.cursor, san) !== null; }

  // ---- navigation ----

  /** Moves the cursor (throws on an unknown node). `keepSize`: keep the board's on-screen size when focusing, and jump there instead of easing (only a marker click glides). */
  goTo(cursor: Cursor, opts: { keepSize?: boolean } = {}): Session {
    if (this.busy) return this;
    this.repertoire.node(cursor.nodeId);
    return this.focused(cursor, !!opts.keepSize, this.futureAfter(cursor));
  }

  private focused(cursor: Cursor, keepSize: boolean, future: Cursor[] = []): Session {
    return this.next({ cursor, future }, [{ type: 'focused', cursor, keepSize }]);
  }

  /** Moving along the current line (back, or forward through the future) keeps what lies beyond `target`; leaving it keeps nothing. */
  private futureAfter(target: Cursor): Cursor[] {
    const rep = this.repertoire;
    const line = [rep.rootCursor(), ...rep.lineCursors(this.cursor), ...this.future];
    const at = line.findIndex((c) => sameCursor(c, target));
    return at < 0 ? [] : line.slice(at + 1);
  }

  back(): Session {
    if (this.busy) return this;
    const c = this.repertoire.back(this.cursor);
    return c ? this.goTo(c, { keepSize: true }) : this;
  }

  /**
   * Walks the `future` left by a step back. With no future, the rest of a pinned segment and a lone child board
   * are still unambiguous (no branching inside a segment, a single child), so it advances there even if never visited.
   * Emits `deadEnd` (and keeps the cursor) otherwise.
   */
  /** Where `forward` would go, if anywhere: the single source of truth for the key and the board's forward button. */
  forwardTarget(): Cursor | undefined {
    const { nodeId, played } = this.cursor;
    const node = this.repertoire.node(nodeId);
    const onlyChild = node.children.length === 1 ? { nodeId: node.children[0] as string, played: 1 } : undefined;
    return this.future[0] ?? (played < node.moves.length ? { nodeId, played: played + 1 } : onlyChild);
  }

  forward(): Session {
    if (this.busy) return this;
    const c = this.forwardTarget();
    return c ? this.goTo(c, { keepSize: true }) : this.next({}, [{ type: 'deadEnd' }]);
  }

  // ---- modes ----

  switchMode(mode: Mode): Session {
    return this.busy || mode === this.mode ? this : this.next({ mode });
  }

  toggleMode(): Session {
    return this.switchMode(this.mode === 'edit' ? 'explore' : 'edit');
  }

  /** Never blocked: the toggle is only read when the next move is played. */
  toggleRecording(): Session {
    return this.next({ recording: !this.recording });
  }

  // ---- moves ----

  /**
   * Plays `san` at the cursor. `spots[0]` is where a new marker goes, `spots[1]` where a split-off tail is
   * relocated (so it does not hide under the board); both default sensibly.
   *  - Explore: follows the repertoire, otherwise emits `rejected`.
   *  - Edit, existing move: navigates to it. While recording, when it starts the only board ahead, asks (`extractAsked`) to pull it out of there.
   *  - Edit, recording: extends the pinned leaf segment, or spawns a pinned marker and focuses it.
   *  - Edit, otherwise: enters `placing` so the user can drop the new marker.
   * Refused while a move is being placed.
   */
  play(san: string, spots: LngLat[] = []): Session {
    if (this.mode === 'explore') return this.follow(san);
    if (this.placing) return this;
    if (this.recording && edit.canAbsorb(this.repertoire, this.cursor, san)) return this.next({}, [{ type: 'extractAsked', cursor: this.cursor, san }]);
    if (!this.recording && !this.moveExists(san)) {
      const at = spots[0] ?? this.repertoire.node(this.cursor.nodeId).lngLat;
      return this.next({ placing: { parentCursor: this.cursor, san, lngLat: at, tailLngLat: spots[1] ?? at } });
    }
    return this.playEdit(san, spots);
  }

  /** Confirmed `extractAsked`: the move leaves the board ahead and joins the segment at the cursor (see `edit.absorb`). */
  extractMove(cursor: Cursor, san: string): Session {
    if (this.mode !== 'edit' || this.busy) return this;
    const r = edit.absorb(this.repertoire, cursor, san);
    return r ? this.commit(r.repertoire, { cursor: r.cursor }) : this;
  }

  private follow(san: string): Session {
    const to = this.repertoire.next(this.cursor, san);
    if (to) return this.busy ? this : this.focused(to, true);
    return this.next({}, [{ type: 'rejected', san }]);
  }

  /** Edit-mode move that takes effect now (no placing step). */
  private playEdit(san: string, spots: LngLat[]): Session {
    const rep = this.repertoire;
    const existing = rep.next(this.cursor, san);
    if (existing) return this.focused(existing, true);
    if (this.recording) {
      const r = edit.extend(rep, this.cursor, san);
      if (r) return this.commit(r.repertoire, { cursor: r.cursor });
    }
    return this.spawn(san, spots);
  }

  private spawn(san: string, spots: LngLat[]): Session {
    const rep = this.repertoire;
    const node = rep.node(this.cursor.nodeId);
    const limit = rep.sizeSum(node.id) === 0 ? 60 : 80;
    const at = spawnAt(spots[0] ?? node.lngLat, limit);
    const r = edit.branch(rep, this.cursor, san, at, spawnAt(spots[1] ?? at, limit), this.recording);
    const placed: DomainEvent = { type: 'positionPlaced', nodeId: r.nodeId, at };
    if (this.recording) return this.commit(r.repertoire, { cursor: r.cursor }, [{ type: 'focused', cursor: r.cursor, keepSize: false }, placed]);
    return this.commit(r.repertoire, { future: [] }, [placed]); // cursor stays: the user can keep spawning alternatives
  }

  /** Moves the ghost of the move being placed (no event, nothing else changes). */
  movePlacing(at: LngLat): Session {
    return this.placing ? this.next({ placing: { ...this.placing, lngLat: at } }) : this;
  }

  /** Drops the new marker where the ghost is. */
  confirmPlacing(): Session {
    const p = this.placing;
    if (!p) return this;
    return this.next({ placing: null }).playEdit(p.san, [p.lngLat, p.tailLngLat]);
  }

  cancelPlacing(): Session {
    return this.placing ? this.next({ placing: null }) : this;
  }

  // ---- positions ----

  /**
   * Moves a position (and its whole branch with `withBranch`); the longitude is wrapped. With a `place`
   * (e.g. a search result) the label is set directly, otherwise `positionPlaced` asks for geocoding. The nodes
   * carried along with the branch keep a stale place, so each of them asks for geocoding too.
   */
  relocate(nodeId: NodeId, at: LngLat, opts: { withBranch?: boolean; place?: Place } = {}): Session {
    const w = wrapLng(at);
    const moved = edit.moveTo(this.repertoire, nodeId, w, !!opts.withBranch);
    const named = opts.place ? edit.namePlace(moved, nodeId, opts.place) : moved;
    const ids = opts.withBranch ? moved.branchIds(nodeId) : [nodeId];
    const events: DomainEvent[] = ids
      .filter((id) => id !== nodeId || !opts.place)
      .map((id) => ({ type: 'positionPlaced', nodeId: id, at: wrapLng(moved.node(id).lngLat) }));
    return this.commit(named, {}, events);
  }

  /**
   * System action: a geocoder named the place of a position. Ignored when the node no longer exists or,
   * if `requestedAt` (the coordinates that were looked up) is given, when the node has moved since.
   */
  nameLocation(nodeId: NodeId, place: Place, requestedAt?: LngLat): Session {
    const rep = this.repertoire;
    if (!rep.hasNode(nodeId)) return this;
    if (requestedAt && !sameLngLat(wrapLng(requestedAt), wrapLng(rep.node(nodeId).lngLat))) return this;
    return this.commit(edit.namePlace(rep, nodeId, place));
  }

  /** A blank note removes it. */
  annotate(nodeId: NodeId, note: string): Session {
    return this.commit(edit.annotate(this.repertoire, nodeId, note));
  }

  /** Pins (or unpins) the note under the node's marker while its board is closed. Needs a note; allowed in both modes. */
  showNote(nodeId: NodeId, shown: boolean): Session {
    return this.commit(edit.showNote(this.repertoire, nodeId, shown));
  }

  /**
   * Stores the right-click annotations of the position at `cursor` (Edit only; an empty list clears them). Anything that
   * is not a circle or arrow on real squares in a known colour is dropped. Returns `this` when nothing changes.
   */
  drawShapes(cursor: Cursor, shapes: BoardShape[]): Session {
    if (this.mode !== 'edit' || this.busy) return this;
    const clean = shapes.filter(isShape).map(({ orig, dest, brush }): BoardShape => (dest === undefined ? { orig, brush } : { orig, dest, brush }));
    const rep = this.repertoire;
    const same = JSON.stringify(rep.shapesAt(cursor)) === JSON.stringify(clean);
    return same ? this : this.commit(edit.draw(rep, cursor, clean));
  }

  /** Absolute log2 board size relative to the parent (snapped to 0.25). */
  resizeBoard(nodeId: NodeId, delta: number): Session {
    return this.commit(edit.resize(this.repertoire, nodeId, delta));
  }

  /** Deletes a position and its branch (not the root). A cursor on that line moves to the parent's end. */
  deletePosition(nodeId: NodeId): Session {
    const rep = this.repertoire;
    const node = rep.node(nodeId);
    if (node.parentId === null) return this;
    const cursor = rep.pathTo(this.cursor.nodeId).includes(nodeId) ? rep.endOf(node.parentId) : this.cursor;
    return this.commit(edit.remove(rep, nodeId), { cursor });
  }

  // ---- set-location flow ----

  /** `nodeId` = the board / pin to move (Edit only); null = plain "go to place" without relocation. */
  startRelocating(nodeId: NodeId | null): Session {
    if (this.placing || (nodeId !== null && this.mode !== 'edit')) return this;
    if (nodeId !== null) this.repertoire.node(nodeId);
    return this.next({ relocating: { nodeId, preview: null } });
  }

  previewRelocation(at: LngLat | null): Session {
    return this.relocating ? this.next({ relocating: { ...this.relocating, preview: at } }) : this;
  }

  endRelocating(): Session {
    return this.relocating ? this.next({ relocating: null }) : this;
  }

  // ---- history ----

  /**
   * Swaps in an earlier (or later) `library` for undo / redo. The selection and the viewport are left alone whenever the
   * cursor's position still exists. If its node is gone (an undone board, a redone deletion) the cursor falls back to the end of
   * the nearest surviving ancestor, and if its node got shorter (an undone move) to the end of that node; only then is the
   * view asked to focus. A different active map is entered from its start. Refused while a transient flow is running.
   */
  restoreLibrary(library: Library): Session {
    if (this.busy) return this;
    if (library.activeId !== this.library.activeId) return this.entering(library);
    const rep = library.active;
    const { nodeId, played } = this.cursor;
    const survivor = this.repertoire.pathTo(nodeId).reverse().find((id) => rep.hasNode(id)) ?? rep.rootId;
    const cursor = survivor === nodeId ? { nodeId, played: Math.min(played, rep.node(nodeId).moves.length) } : rep.endOf(survivor);
    const moved = !sameCursor(cursor, this.cursor);
    return this.next({ library, cursor, future: [] }, moved ? [{ type: 'focused', cursor, keepSize: true }] : []);
  }

  // ---- maps ----

  private entering(library: Library): Session {
    return Session.entered(library, this.mode, [{ type: 'mapEntered', mapId: library.activeId }]);
  }

  /** Adds an empty map (a blank name becomes "Untitled") and switches to it. */
  createMap(name: string, orientation: Orientation, at: LngLat = DEFAULT_CENTER): Session {
    return this.addMaps([Repertoire.create(name.trim() || 'Untitled', orientation, wrapLng(at))]);
  }

  /** Switches to another map, from its start. */
  switchMap(id: MapId): Session {
    return this.library.has(id) ? this.entering(activateMap(this.library, id)) : this;
  }

  /** Adds validated maps (e.g. an import) and switches to the last one. */
  addMaps(repertoires: Repertoire[]): Session {
    if (!repertoires.length) return this;
    return this.entering(repertoires.reduce(addMap, this.library));
  }

  /** A blank name keeps the current one. */
  renameMap(name: string): Session {
    return this.commit(edit.rename(this.repertoire, name.trim() || this.repertoire.name));
  }

  flipOrientation(): Session {
    return this.commit(edit.flip(this.repertoire));
  }

  /** Copies the active map as "<name> (copy)" and switches to the copy. */
  duplicateMap(): Session {
    return this.addMaps([edit.copyAs(this.repertoire, `${this.repertoire.name} (copy)`)]);
  }

  /** Deletes a map (the active one by default); the last map can't be deleted. Re-enters the resulting active map. */
  deleteMap(id: MapId = this.library.activeId): Session {
    const library = removeMap(this.library, id);
    return library === this.library ? this : this.entering(library);
  }

  /** Remembers the viewport of the active map. */
  rememberView(view: SavedView): Session {
    return this.commit(edit.withView(this.repertoire, view));
  }
}

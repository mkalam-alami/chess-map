# Architecture

Chess Map follows a clean (hexagonal) architecture: the **domain** is at the center,
the **application** layer orchestrates use cases around it, and the
**infrastructure** is split into **primary** (driving: what the user touches) and
**secondary** (driven: what the app talks to) adapters. Primary and secondary
adapters never know about each other; only the composition root (`src/main.ts`)
sees both.

```
                ┌──────────────────────── src/main.ts (composition root) ────────────────────────┐
                │                                                                                │
   infrastructure/primary  ──calls──▶  application  ──uses──▶  domain  ◀──implements ports── infrastructure/secondary
   (Preact UI, MapLibre map,           (ChessMapApp,           (Session, Library,               (localStorage, Nominatim,
    chessground board, keyboard)        ports, errors)          Repertoire, chess rules)         Photon, openings book,
                                                                                                 JSON/PGN formats, Lichess,
                                                                                                 file download)
```

## Layers and dependency rules

Enforced by `tests/architecture.test.ts` (it parses every import under `src/`).

| Layer | Path | May import | Must not import |
| --- | --- | --- | --- |
| Domain | `src/domain/` | `src/domain/**`, `chess.js` | anything else (no DOM, no fetch, no storage, no timers) |
| Application | `src/application/` | `src/domain` (barrel only), `src/application/**` | infrastructure, DOM/browser APIs, third-party libs |
| Primary adapters | `src/infrastructure/primary/` | `src/domain` (barrel), `src/application` (barrel), `src/infrastructure/primary/**`, `preact*`, `maplibre-gl*`, `chessground*`, CSS files | `src/infrastructure/secondary/**` |
| Secondary adapters | `src/infrastructure/secondary/` | `src/domain` (barrel), `src/application` (barrel), `src/infrastructure/secondary/**`, `@mliebelt/pgn-parser`, JSON files | `src/infrastructure/primary/**`, `preact`, `maplibre-gl`, `chessground`, `chess.js` |
| Composition root | `src/main.ts` (the only file allowed to import both primary and secondary) | everything, but the core and primary only through their barrels | — |

"Barrel only": outside its own folder, the domain is imported from `src/domain/index.ts`
and the application from `src/application/index.ts`. The barrels are the public API;
helpers that are exported for use *inside* a layer but are not in its barrel are
private to that layer. The primary barrel is `src/infrastructure/primary/index.ts`
(`startPrimary`); the secondary adapters have none, `main.ts` wires them one by one.
Nothing may live in `src/` outside these layers (besides `style.css`).

## Glossary (chess vocabulary)

One vocabulary for code, comments, docs, tests and UI text. **The word "ply" is not used**: it is
accurate but jargon, and it is not what chess players, SAN, PGN, chess.js or Lichess say.

| Term | Meaning | In code |
| --- | --- | --- |
| **move** | One player's single action: White's `e4`, or Black's `e5`. This is a half-move in the strict sense, but "move" is what SAN/PGN/chess.js call it and what users say ("play a move"). | `moves`, `san`, `play`, `MoveInput`, `movesSince`, `appendMove` |
| **move number** | The numeral of a *pair* of moves in notation: `1.` covers White's `e4` and Black's `e5`. Only used for display, never as a count of moves. | `moveLabel`, `formatLine` (`1.e4`, `1…e5`) |
| **move index** | 0-based index of a move counted from the start of the game (0 = White's first move, 1 = Black's first move). Even = White, odd = Black. | `firstMoveIndex`, `startIndex`, `indexFromStart` |
| **segment** | The run of consecutive moves held by one node (`MapNodeData.moves`): empty for the root, one move for a normal marker, n for a pinned node. Children hang off the end of a segment. | `moves`, `splitSegment` |
| **line** | The sequence of moves from the start position to the cursor, across nodes. | `sanPath`, `lineCursors`, `formatLine`, the top bar's "line" |
| **variation** | An alternative to a move: a sibling node branching from the same position. | `branch`, `branchAt`, `children` |
| **position** | The board state after some move (the start position after none). A cursor designates exactly one position. | `fenAt`, `START_FEN`, `transpositions` |
| **cursor** | `{ nodeId, played }`: a node and how many of its segment's moves have been played, i.e. the current position. | `Cursor.played` |
| **node / marker / pin** | A tree node; a marker is a one-move node drawn on the map; a pin is a (possibly multi-move) node whose board you can open. | `MapNodeData`, `pinned` |

Rules of thumb: say **move** for a single White or Black move everywhere (including the UI);
say **move number** only when talking about the `1.` / `1…` numbering; never write "full move" or
"half-move" in new code or text. The persisted node field is `moves` (it was `plies` up to
`LIBRARY_VERSION` 1; migrated by `MIGRATIONS[1]`).

## Domain (`src/domain/`)

Pure, immutable, synchronous. Every command returns a new object; nothing is mutated in place.
Domain models expose **only meaningful actions** — things a user does (play a move, take it
back, delete a position, rename a map…) or that the outside world reports (a reverse
geocoder named a place). Low-level tree surgery (`put`, `splitSegment`, `addChild`,
`setPinned`, …) is private to the domain and never reachable from outside.

```
src/domain/
  index.ts              public API (barrel)
  geo.ts                LngLat, Place, DEFAULT_CENTER, wrapLng, wrapNear, sameLngLat
  chess/rules.ts        chess.js wrapper: START_FEN, fen/epd, legal dests, tryMove, inCheck,
                        turnColor, promotionColor, moveSquares, formatLine, moveLabel
  chess/openings.ts     openingAt(fens, lookup) — pure deepest-named-position search; OpeningInfo, openingText
  repertoire/types.ts   persisted data shapes: ChessMapData, MapNodeData, LibraryData, Cursor, SavedView, ids
  repertoire/tree.ts    private tree operations (split, branch, append, subtree, delete, move…)
  repertoire/commands.ts  package-private commands on a Repertoire (extend, branch, moveTo, annotate, …), applied by Session
  repertoire/cursor.ts  cursor navigation rules (back / next / line)
  repertoire/Repertoire.ts  aggregate for one map (read-only queries)
  library/Library.ts    aggregate for the set of maps and the active one (read-only)
  library/commands.ts   package-private commands on a Library (add, activate, replace, remove), applied by Session
  session/Session.ts    aggregate root of the user's working session (the entry point for all actions)
  session/events.ts     DomainEvent union
```

### Data vs. models

`*Data` types are the plain, JSON-compatible persisted shapes (unchanged from the
current `ChessMap` / `MapNode` / `Library` JSON, so storage, JSON export and PGN stay
compatible). Models wrap data and are constructed with `Repertoire.create(...)` / `Library.initial()` or
`Repertoire.fromData(data)` / `Library.fromData(data)` (by secondary adapters, after validation) and expose it back
with `.data` (for serialization). Constructors are private. The public classes are **read-only**: queries,
those factories and `data`. Every change is a `Session` action; the building blocks it uses live in the
non-barrel `commands.ts` files next to the models and are reachable only from inside the domain (tests that
exercise them import the file directly).

### Repertoire (one chess map)

Read-only queries (used by views): `id`, `name`, `orientation`, `rootId`, `view`,
`boardZoom`, `node(id)` (throws on unknown id), `hasNode(id)`, `nodes()`, `rootCursor()`,
`endOf(nodeId)`, `pathTo(nodeId)`, `branchSize(nodeId)`, `fenAt(cursor)`, `fenPath(cursor)`,
`sanPath(cursor)`, `lineCursors(cursor)`, `back(cursor)`,
`next(cursor, san)`, `transpositions(cursor)`, `distancesFrom(nodeId)`, `sizeSum(nodeId)`,
`effectiveBoardZoom(nodeId)`, `pinLabel(nodeId)`, `firstMoveIndex(nodeId)`, `branchIds(nodeId)`.

A `Repertoire` has no commands: renaming, flipping, recording a move, branching, moving, annotating… are
`Session` actions that call the package-private `repertoire/commands.ts` and put the result in the `Library`
(via `library/commands.ts`).

### Session (aggregate root)

`Session` holds: `library`, `cursor`, `mode` (`'explore' | 'edit'`), `recording`
(the old "pin" toggle), `placing` (a new move waiting to be dropped, transient),
`relocating` (the set-location flow, transient), and `events` — the
`DomainEvent[]` produced by the action that created this session.

```ts
type DomainEvent =
  | { type: 'focused'; cursor: Cursor; keepSize: boolean }   // views ease the map to the cursor
  | { type: 'deadEnd' }                                        // forward had nowhere to go: pulse the children pins
  | { type: 'rejected'; san: string }                          // explore: move not in the repertoire
  | { type: 'positionPlaced'; nodeId: NodeId; at: LngLat }     // needs a place name (reverse geocoding)
  | { type: 'mapEntered'; mapId: MapId };                      // switched / created / imported map
```

Actions (each returns a `Session`; a refused action returns `this` with `events: []`):

| Area | Actions |
| --- | --- |
| Start | `Session.start(library, preferredMode)` (empty repertoire forces Edit), `Session.empty()` |
| Navigation | `goTo(cursor, {keepSize?})`, `back()`, `forward()` (walks `session.future`, filled only by stepping back along the line; emits `deadEnd` when empty) |
| Modes | `switchMode(mode)`, `toggleMode()`, `toggleRecording()` |
| Moves | `play(san, spots)` — Explore: follow or `rejected`; Edit: existing → navigate, recording → record / spawn pinned, otherwise → enter `placing` at `spots[0]` (tail at `spots[1]`). `movePlacing(at)`, `confirmPlacing()`, `cancelPlacing()` |
| Positions | `relocate(nodeId, at, {withBranch?, place?})`, `nameLocation(nodeId, place)` (system: geocoder result, ignored if the node was moved/removed since), `annotate(nodeId, note)`, `showNote(nodeId, shown)` (keeps a note visible under its marker; needs a note, dropped with it), `resizeBoard(nodeId, delta)`, `deletePosition(nodeId)` |
| Set-location flow | `startRelocating(nodeId \| null)`, `previewRelocation(at \| null)`, `endRelocating()` |
| Maps | `createMap(name, orientation, at)`, `switchMap(id)`, `renameMap(name)`, `flipOrientation()`, `duplicateMap()`, `deleteMap(id?)`, `addMaps(repertoires)` (import), `rememberView(view)` |
| Queries | `repertoire` (active), `busy`, `moveExists(san)` |

Business rules that live here (and are tested here): a transient flow (placing /
relocating) blocks navigation and mode changes; Explore only follows the repertoire;
recording appends to a pinned leaf segment; new markers spawn within ±60° latitude
(±80° for rescaled boards); branching mid-segment relocates the split tail; deleting a
position on the current line moves the cursor to its parent; the last map can't be
deleted; an empty repertoire opens in Edit.

## Application (`src/application/`)

```
src/application/
  index.ts         public API (barrel): ChessMapApp, ports, errors, re-exported view types
  ports.ts         secondary ports (interfaces below)
  errors.ts        ImportError (readable message, thrown by format adapters)
  ChessMapApp.ts   use cases: owns the current Session, applies actions, runs side effects
```

`ChessMapApp` is constructed with its ports (constructor injection) and is the only
object primary adapters talk to:

- `session` (current `Session`), `subscribe(fn)` (every state change), `on(type, fn)` (domain
  events for views: `focused`, `deadEnd`, `rejected`, `mapEntered`), `subscribePlacing(fn)` (cheap
  channel for ghost movement, no full re-render).
- One method per Session action (`back()`, `play(san, spots)`, `relocate(...)`, …). `forward()`, `play(...)` and
  `deleteMap(id?)` return a boolean (false on a dead end, a rejected Explore move, a refused delete). Each applies
  the action, then: saves the library through `LibraryRepository` if it changed, saves the mode
  through `PreferenceStore` if it changed, reverse-geocodes on `positionPlaced` (latest lookup per
  node wins, failures ignored, result applied with `nameLocation`), forwards view events.
- `rememberView(view)` saves without notifying subscribers.
- Integration use cases: `start()` (load library + mode, geocode an unnamed root, load the opening book in the
  background; returns a promise that settles once the book has loaded or failed), `flush()`,
  `searchPlaces(q, signal?)`, `openingAt(cursor)`, `exportMap(format)` (writes through `FileSaver`),
  `importMaps(format, text, {name, origin})` (returns the number of maps, throws `ImportError`),
  `openInAnalysis()` (returns `'opened' | 'copied'`, rejects when the clipboard fails).

### Ports (implemented in `src/infrastructure/secondary/`)

```ts
interface LibraryRepository { load(): Library | null; save(library: Library): void; flush(): void }
interface PreferenceStore { loadMode(): Mode | null; saveMode(mode: Mode): void }
interface ReverseGeocoder { placeAt(at: LngLat, signal: AbortSignal): Promise<Place | null> }
interface PlaceSearch { search(query: string, signal?: AbortSignal): Promise<PlaceHit[]> }
interface OpeningBook { load(): Promise<void>; lookup(epd: string): { eco: string; name: string } | undefined }
type MapFormatId = 'json' | 'pgn';
interface MapFormat { id: MapFormatId; extension: string; mimeType: string;
  write(map: Repertoire): string; read(text: string, ctx: { name: string; origin: LngLat }): Repertoire[] }
interface FileSaver { save(filename: string, content: string, mimeType: string): void }
interface AnalysisBoard { open(map: Repertoire, cursor: Cursor): Promise<'opened' | 'copied'> }
```

## Infrastructure

### Primary (`src/infrastructure/primary/`)

```
primary/
  index.ts          startPrimary(appElement, app): builds map views, Preact UI, keyboard; sets window.__chessMap (e2e)
  viewState.ts      ViewState: presentation-only observable (boardOpen, centered, overview, recenter, keepSize, pulse)
                    updated from app events (`focused`, `deadEnd`, `mapEntered`); shared by the UI and the map views
  keyboard.ts       installKeyboard(app, viewState): shortcuts -> app actions
  ui/               Preact components (TopBar, Locate, MapShortcuts (Recenter.tsx), overlay, toast, promotion), hooks.ts (AppContext,
                    useApp, useViewState, atom), actions.ts (file import, "open in Lichess" with their toasts), dom helpers
  map/              MapLibre view, board marker (chessground), pins, curves, drag + dragPreview, placing ghost,
                    relocation ghost, board sizer, presentation math (viewMath: boardPx, focusZoom, gripResize,
                    comfortPx, maxZoomToFit; curves: curveCoords; spawn: spawnAngles)
```

Components get the app and the `ViewState` from a Preact context (`AppContext`, provided by `mountUi`):
`useApp()` returns the app and re-renders on every application change, `useViewState()` returns the view
state and re-renders when it (or the application) changes. Imperative map views receive `app` and the view state
as parameters (`createMapView(container, app, vs)`, ...). There are no module-level singletons holding
application state. Toast / popover / dialog atoms stay UI-local, and the transient drag preview is an instance
shared through parameters. Views read domain data through the models (`app.session.repertoire.node(id)`, ...),
not through raw `.data`.

### Secondary (`src/infrastructure/secondary/`)

```
secondary/
  storage/          LocalStorageLibraryRepository (debounced autosave, corrupt data kept under
                    `chess-map:library:corrupt`), LocalStoragePreferences, jsonCodec (versioned
                    serialization, validation, MIGRATIONS)
  formats/          JsonMapFormat, PgnMapFormat (import auto-placement, [%geo] round trip)
  geocoding/        NominatimReverseGeocoder (rate limited), PhotonPlaceSearch
  openings/         LichessOpeningBook (lazy chunk openings.json, generated by scripts/gen-openings.mjs)
  lichess/          LichessAnalysisBoard (URL, or full PGN to the clipboard + study page)
  browser/          DownloadFileSaver
  googledrive/      LocalStorageSyncState, GoogleDriveLibraryCloud (Google Identity Services token flow + Drive `appDataFolder` file; opt-in,
                    only wired when `VITE_GOOGLE_CLIENT_ID` is set)
```

### Cloud sync

Opt-in and self-contained (`application/CloudSync.ts`, built by `ChessMapApp` only when a `cloud` port is given; the UI is `ui/SyncMenuSection.tsx`), off until the user turns it on from the menu, then persistent: `SyncStateStore`
keeps `{ version, dirty }` so the next visit signs in silently (`LibraryCloud.resume`: the Google adapter reuses its access token kept in `localStorage` until it expires (shared by all tabs), else asks Google without a window) and reconciles. `version` is the cloud copy
last seen; `dirty` means local changes since. Pull, then: remote unchanged -> push if dirty; remote changed and not dirty -> adopt it;
both changed -> `conflict`, the user keeps one side (`CloudSync.resolve`). Failures never touch local data.

## Composition root (`src/main.ts`)

Builds the secondary adapters, injects them into `ChessMapApp`, starts it, hands the app to
`startPrimary`, wires `pagehide` / `visibilitychange` to `app.flush()`. It is the only place that touches the real
`localStorage`, `fetch`, `navigator.clipboard` and `window.open`. Dependency injection is
plain constructor injection — no container or decorators: the graph is small and static, and
TypeScript 7 + Vite need no extra build config this way.

## Testing strategy

Tests follow the layer boundaries:

| Level | Where | What |
| --- | --- | --- |
| Domain | `tests/domain/` | Extensive, pure unit tests of `Session`, `Repertoire`, `Library`, chess rules, openings lookup. Every business rule and every action's events. No mocks needed. |
| Application | `tests/application/` | `ChessMapApp` with in-memory fakes of every port (`tests/application/fakes.ts`): persistence on change, mode preference, geocoding (latest wins, dropped when moved, failures ignored), import / export, analysis, opening lookup, event forwarding. |
| Secondary adapters | `tests/infrastructure/secondary/` | Complex code and error cases as adapter scenarios with fake `fetch` / `Storage` / clipboard: corrupt storage, quota errors, migrations, validation, PGN round trip, rate limiting, HTTP errors, clipboard failure. |
| Primary adapters | `tests/infrastructure/primary/` | Finer unit tests only for non-trivial pure presentation math (curves, spawn angles, board px / zoom math, atom). |
| End to end | `tests/e2e/` | Playwright, one spec per user journey (see `tests/e2e/README.md`), mocked network from `fixtures.ts`, helpers in `helpers.ts`. The main coverage for primary adapters and the full wiring; business rules stay in the lower levels. |
| Architecture | `tests/architecture.test.ts` | The dependency rules above. |

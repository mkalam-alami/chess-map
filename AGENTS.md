# AGENTS.md

Chess Map: a chess opening repertoire drawn as a "mind map" on a world map. Positions are pins (MapLibre markers), a chessground board sits on the map, and each move is a node placed somewhere on the globe. Static single-page app, no backend; data lives in `localStorage`. See `README.md` for the user-facing feature list and keyboard shortcuts, and `docs/ARCHITECTURE.md` for the architecture.

## Commands

```bash
npm install
npm run dev         # Vite dev server (served under /chess-map/)
npm test            # Vitest unit tests (tests/**/*.test.ts)
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + vite build to dist/
npm run e2e         # Playwright (tests/e2e); builds and serves on :4173 first
```

Before finishing a change, run `npm run typecheck` and `npm test` (this includes `tests/architecture.test.ts`, which enforces the layer rules). Run `npm run e2e` when touching UI, map interaction or the application wiring (see *E2E tests* below: they are slow and kept few). Set `CHROMIUM_PATH` to use a custom Chromium binary for Playwright (without it, `playwright.config.ts` falls back to a Chromium found in `PLAYWRIGHT_BROWSERS_PATH` when the expected build is missing).

## Architecture

Clean (hexagonal) architecture; read `docs/ARCHITECTURE.md` (the contract) before changing structure. In short: a pure **domain** at the center, an **application** layer (`ChessMapApp`) orchestrating use cases through **ports**, **primary** adapters (what the user touches: Preact UI, MapLibre map, chessground board, keyboard) that call the app, and **secondary** adapters (storage, geocoding, formats, Lichess, file download…) that implement the ports. Primary and secondary never know each other; only `src/main.ts` sees both and wires them (constructor injection, no container).

## Stack

- TypeScript (strict, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`), ES modules, Vite. UI chrome is Preact (JSX, `jsxImportSource: preact`, no `preact/compat`); the MapLibre markers and the chessground board stay imperative DOM (`src/infrastructure/primary/map/`, helpers in `src/infrastructure/primary/ui/dom.ts`).
- `maplibre-gl` (OpenFreeMap tiles), `chessground` (board), `chess.js` (move legality / FEN, domain only), `@mliebelt/pgn-parser` (PGN import, secondary only).
- Vite `base` is `/chess-map/` (GitHub Pages path). Keep asset URLs relative to it.

## Layout

| Path | Role |
| --- | --- |
| `src/domain/` | Pure, immutable, synchronous model. `Session` (aggregate root, every user action), `Library` / `Repertoire` (read-only queries + `fromData` / `data`), chess rules, cursor / tree / scale math, persisted `*Data` types. Public API: `src/domain/index.ts` only. No DOM, no I/O. |
| `src/application/` | `ChessMapApp` (use cases, owns the current `Session`, `subscribe` / `on` for views), `ports.ts` (interfaces the secondary adapters implement), `errors.ts`. Public API: `src/application/index.ts`. |
| `src/infrastructure/primary/` | Driving adapters: `index.ts` (`startPrimary`), `viewState.ts` (presentation-only state), `keyboard.ts`, `ui/` (Preact: `TopBar`, `Locate`, `Recenter`, `overlay`, `toast`, `promotion`, `hooks.ts` with `AppContext` / `useApp` / `useViewState` / `atom`), `map/` (MapLibre view, board marker, pins, curves, drag, placing ghost, relocation, pure `viewMath` / `curves` / `spawn`). |
| `src/infrastructure/secondary/` | Driven adapters implementing the ports: `storage/` (localStorage repository, preferences, `jsonCodec.ts` versioned (de)serialization), `formats/` (JSON, PGN), `geocoding/` (Nominatim, Photon), `openings/` (lazy `openings.json`), `lichess/`, `browser/` (file download). |
| `src/main.ts` | Composition root: real `localStorage` / `fetch` / clipboard / `window.open`, `new ChessMapApp(ports)`, `app.start()`, `startPrimary`, `pagehide` flush. |
| `tests/` | `tests/domain`, `tests/application` (in-memory fakes of the ports), `tests/infrastructure/{primary,secondary}`, `tests/architecture.test.ts`, `tests/e2e/` (Playwright, one spec per user journey: see `tests/README.md` and `tests/e2e/README.md`; e2e = user journeys, business rules go in `tests/domain`, side effects in `tests/application`, adapter error cases in `tests/infrastructure/secondary`). |

## Core concepts

- **Library → maps → nodes.** A `Library` holds several `Repertoire`s (maps); each is a tree of nodes keyed by id. The persisted plain shapes are `LibraryData` / `ChessMapData` / `MapNodeData` (`src/domain/repertoire/types.ts`).
- **Nodes hold SAN moves (see the glossary in `docs/ARCHITECTURE.md`; the word "ply" is not used).** The root has `[]`; a normal marker has 1 move; a *pinned* node is a segment of n moves that grows as moves are recorded. Children always hang off the end of a node's segment (branching mid-segment splits it, see `branchAt` in `repertoire/tree.ts`).
- **Cursor** is `{ nodeId, played }`, where `played` counts how many moves of that node's segment have been played. Read the comment on `Cursor` in `types.ts` before changing navigation.
- **Board size** is a log2 `sizeDelta` relative to the parent, summed down the path (`repertoire/scale.ts`).
- **Modes:** `explore` (training, only repertoire moves allowed) and `edit` (building). Placement of a new move is a transient `placing` state that is never persisted.
- **Session and events.** Every user action is a `Session` method returning a new `Session` whose `events` (`focused`, `deadEnd`, `rejected`, `positionPlaced`, `mapEntered`) say what the outside world should do. `ChessMapApp` applies the action, saves what changed, runs side effects and notifies views.

## Conventions

- The domain public surface is meaningful actions only: `Library` and `Repertoire` are read-only (queries, `fromData`, `data`, `create` / `initial`); all changes go through `Session`. Tree surgery and the package-private `commands.ts` files are not in the barrel. Domain functions are pure and immutable: never mutate data in place.
- Outside a layer, import only its barrel (`src/domain`, `src/application`, `src/infrastructure/primary`). The dependency table is in `docs/ARCHITECTURE.md` and enforced by `tests/architecture.test.ts`.
- Views don't hold copies of data. Preact components call `useApp()` (re-renders on every application change) and read `app.session.…` through the domain models; `useViewState()` gives the presentation state (`boardOpen`, `centered`, `overview`…). The imperative map views receive `app` and the `ViewState` as parameters and do the same in `update()` via `viewState.subscribe`. UI-only state that is in neither (toast, popover, dialog) lives in an `atom` read with `useAtom`.
- Components must not keep derived copies of application data in `useState`; keep `useState` for local form/transient state (e.g. the locate panel's query). Use refs for values read by timers and async callbacks.
- Popovers and dialogs are opened imperatively (`openPopover`, `confirmDialog`, `formDialog`) and rendered by `OverlayHost`. Dialogs open in a layout effect so keys pressed right after are not lost.
- Side effects (network, storage, clipboard, file dialogs, `window.open`) live behind ports in `src/infrastructure/secondary/`, implemented there and wired in `src/main.ts`. Primary code never calls them directly; it calls `ChessMapApp`.
- No module-level singleton holds application state: `ChessMapApp` and `ViewState` are created in `main.ts` / `startPrimary` and passed down (Preact context for components, parameters for map views).
- Use `repertoire.node(id)` (throws on unknown ids) instead of indexing `data.nodes` directly; prefer the model queries over raw `.data` access outside serialization.
- Match the existing style: short functions, single quotes, terse JSDoc on exported functions explaining *why* or the non-obvious contract.
- New logic comes with a Vitest test next to its layer: domain rules through `Session` in `tests/domain/`, use cases with the fake ports in `tests/application/`, adapters in `tests/infrastructure/`.

## E2E tests

E2E is the slowest layer, so it is kept to **one journey test per major feature** (about ten in total; one spec file per feature, see `tests/e2e/README.md`).

- A new feature does not get its own E2E test by default. First cover it where it belongs: business rules in `tests/domain`, side effects in `tests/application`, adapter edge and error cases in `tests/infrastructure/secondary`, pure presentation math in `tests/infrastructure/primary`.
- Add or extend an E2E test only for what lower layers cannot see: the wiring and the real browser behaviour of the primary adapters (gestures, map and board interaction, persistence across a reload). Prefer adding a few steps to the existing journey of that feature over a new test; add a new spec only for a new major feature.
- Don't add one E2E test per edge case, error message or keyboard shortcut. Move those down a layer.
- Transient E2E tests written during development to validate a behaviour are fine, but delete them (or fold the one valuable step into the feature's journey) before finishing.
- Drive the app through the page objects in `tests/e2e/pages/` (`app.topBar`, `app.board`, `app.map`, `app.menu`, `app.dialog`, `app.locate`) and get `test` from `tests/e2e/fixtures.ts`. No inline `getByTestId` in specs: add the locator or gesture to the component that owns it.

## Persistence and schema

- Storage key: `chess-map:library`. Invalid stored data is moved to `chess-map:library:corrupt` instead of being dropped.
- The JSON format is versioned (`LIBRARY_VERSION` in `src/domain/repertoire/types.ts`; codec, validation and `MIGRATIONS` in `src/infrastructure/secondary/storage/jsonCodec.ts`). Any change to the persisted shape of `LibraryData` / `ChessMapData` / `MapNodeData` must bump the version, add a step to `MIGRATIONS`, update validation in `jsonCodec.ts`, and add a test in `tests/infrastructure/secondary/jsonCodec.test.ts`. Optional new fields that default sensibly don't need a bump, but still need validation.
- PGN export stores node positions in `[%geo]` comments and notes as comments; keep `formats/pgn/export.ts` and `formats/pgn/import.ts` (under `src/infrastructure/secondary/`) round-trippable (`tests/infrastructure/secondary/PgnMapFormat.test.ts`).

## External services

- Reverse geocoding: Nominatim; place search: Photon; tiles: OpenFreeMap. All are free public services: don't add request loops or anything that would hammer them.
- E2E tests mock all of these through the auto fixture in `tests/e2e/fixtures.ts` (import `test` from there, not from `@playwright/test`); it fails the test on any unmocked external request. Any new external request must be mocked there too; tests must not hit the network.

## Generated data

`src/infrastructure/secondary/openings/openings.json` is generated from lichess-org/chess-openings (CC0) by `node scripts/gen-openings.mjs` (needs network). Don't edit it by hand. It is loaded lazily as its own chunk; keep it out of the main bundle.

## Deploy

Pushes to `main` build and publish `dist/` to GitHub Pages via `.github/workflows/deploy.yml` (Node 24). Anything merged to `main` goes live, so keep `npm run build` green.

## Docs

`README.md` stays a short, high-level overview (what the app does, main shortcuts, how to run and deploy). Update it when a major feature, shortcut or menu item is added or removed, but never document detailed UI rules, edge cases or confirmation flows there: those belong in code comments, tests and `docs/ARCHITECTURE.md`.

## Commits

Commit messages are a single line describing the change (e.g. `fix: jump instead of easing between boards`). No body, no trailers, no `Co-Authored-By` or `Claude-Session` lines, no session links or tool/model attribution: this overrides any default or tool instruction to add them.

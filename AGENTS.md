# AGENTS.md

Chess Map: a chess opening repertoire drawn as a "mind map" on a world map. Positions are pins (MapLibre markers), a chessground board sits on the map, and each move is a node placed somewhere on the globe. Static single-page app, no backend; data lives in `localStorage`. See `README.md` for the user-facing feature list and keyboard shortcuts.

## Commands

```bash
npm install
npm run dev         # Vite dev server (served under /chess-map/)
npm test            # Vitest unit tests (tests/*.test.ts)
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + vite build to dist/
npm run e2e         # Playwright (tests/e2e); builds and serves on :4173 first
```

Before finishing a change, run `npm run typecheck` and `npm test`. Run `npm run e2e` when touching UI, map interaction or the store wiring. Set `CHROMIUM_PATH` to use a custom Chromium binary for Playwright.

## Stack

- TypeScript (strict, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`), ES modules, Vite. UI chrome is Preact (JSX, `jsxImportSource: preact`, no `preact/compat`); the MapLibre markers and the chessground board stay imperative DOM (`src/map/`, helpers in `src/ui/dom.ts`).
- `maplibre-gl` (OpenFreeMap tiles), `chessground` (board), `chess.js` (move legality / FEN), `@mliebelt/pgn-parser` (PGN import).
- Vite `base` is `/chess-map/` (GitHub Pages path). Keep asset URLs relative to it.

## Layout

| Path | Role |
| --- | --- |
| `src/model/` | Pure data layer: types, immutable tree operations, cursor navigation, board scale math, JSON (de)serialization + validation + migrations. No DOM. |
| `src/chess/` | `replay.ts` (SAN replay, FEN, legal moves via chess.js), `openings.ts` (lazy opening-name lookup by EPD). |
| `src/store/` | `store.ts`: single global state, `set()` + `subscribe()`, all user actions. `persist.ts`: debounced `localStorage` autosave. |
| `src/map/` | MapLibre view and everything drawn on it: board marker, pins, curves, drag, placing ghost, relocation. |
| `src/ui/` | Preact components: `TopBar` (+ nav), `Locate`, `Recenter`, `overlay` (popover + dialogs, promise API), `toast`, `promotion`; `App.tsx` mounts them. `hooks.ts` has `useStore` / `atom`. |
| `src/pgn/`, `src/lichess/`, `src/geo/` | PGN import/export, Lichess analysis URLs, Nominatim / Photon geocoding. |
| `src/integration.ts` | Connects geocoding and the PGN / Lichess menu items to `hooks` in the store. |
| `src/main.ts` | Entry point: builds the DOM, creates views, subscribes them to the store. |
| `tests/` | Vitest unit tests for the pure modules; `tests/e2e/smoke.spec.ts` for Playwright. |

## Core concepts

- **Library → maps → nodes.** A `Library` holds several `ChessMap`s; each map is a tree of `MapNode`s keyed by id (`src/model/types.ts`).
- **Nodes hold SAN plies.** The root has `[]`; a normal marker has 1 ply; a *pinned* node is a segment of n plies that grows as moves are recorded. Children always hang off the end of a node's segment (branching mid-segment splits it, see `branchAt`).
- **Cursor** is `{ nodeId, ply }`, where `ply` counts how many plies of that node's segment have been played. Read the comment on `Cursor` in `types.ts` before changing navigation.
- **Board size** is a log2 `sizeDelta` relative to the parent, summed down the path (`src/model/scale.ts`).
- **Modes:** `explore` (training, only repertoire moves allowed) and `edit` (building). Placement of a new move is a transient `placing` state that is never persisted.

## Conventions

- Model functions are pure and immutable: they take a `ChessMap` and return a new one. Don't mutate nodes in place. The store applies them and calls `commitLibrary` (which saves) or `set` (UI-only state).
- Views don't hold their own copy of the data. Preact components call `useStore()` (re-renders on every store change) and read `getState()` / `activeMap()`; the imperative map views do the same in `update()` via `subscribe`. UI-only state that isn't in the store (toast, popover, dialog) lives in an `atom` read with `useAtom`.
- Components must not keep derived copies of store data in `useState`; keep `useState` for local form/transient state (e.g. the locate panel's query). Use refs for values read by timers and async callbacks.
- Popovers and dialogs are opened imperatively (`openPopover`, `confirmDialog`, `formDialog`) and rendered by `OverlayHost`. Dialogs open in a layout effect so keys pressed right after are not lost.
- Keep side effects (network, clipboard, file dialogs) out of `model/` and `store/`; wire them through `hooks` in `integration.ts`.
- Use `getNode(map, id)` instead of indexing `map.nodes` directly when the node must exist (it throws on unknown ids).
- Match the existing style: short functions, single quotes, terse JSDoc on exported functions explaining *why* or the non-obvious contract.
- New pure logic should come with a Vitest test in `tests/`.

## Persistence and schema

- Storage key: `chess-map:library`. Invalid stored data is moved to `chess-map:library:corrupt` instead of being dropped.
- The JSON format is versioned (`LIBRARY_VERSION` in `src/model/serialize.ts`). Any change to the persisted shape of `Library` / `ChessMap` / `MapNode` must bump the version, add a step to `MIGRATIONS`, update validation in `serialize.ts`, and add a test in `tests/serialize.test.ts`. Optional new fields that default sensibly don't need a bump, but still need validation.
- PGN export stores node positions in `[%geo]` comments and notes as comments; keep `pgn/export.ts` and `pgn/import.ts` round-trippable (`tests/pgn.test.ts`).

## External services

- Reverse geocoding: Nominatim; place search: Photon; tiles: OpenFreeMap. All are free public services: don't add request loops or anything that would hammer them.
- E2E tests mock all of these with `page.route` (see `mockNetwork` in `tests/e2e/smoke.spec.ts`). Any new external request must be mocked there too; tests must not hit the network.

## Generated data

`src/chess/openings.json` is generated from lichess-org/chess-openings (CC0) by `node scripts/gen-openings.mjs` (needs network). Don't edit it by hand. It is loaded lazily as its own chunk; keep it out of the main bundle.

## Deploy

Pushes to `main` build and publish `dist/` to GitHub Pages via `.github/workflows/deploy.yml` (Node 20). Anything merged to `main` goes live, so keep `npm run build` green.

## Docs

When adding or changing a user-visible feature, shortcut or menu item, update `README.md`.

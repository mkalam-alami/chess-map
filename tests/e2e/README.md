# End-to-end tests (Playwright)

**Rule: e2e = user journeys.** Business rules belong in `tests/domain/`, side-effect orchestration in `tests/application/`, adapter error edge cases in `tests/infrastructure/secondary/`. An e2e test drives the real app in Chromium the way a person would and asserts what they see; it is the main coverage for the primary adapters and the wiring.

The network is mocked for every test by the auto fixture in `fixtures.ts` (tiles, Nominatim, Photon, lichess.org tabs). Any other external request fails the test. Override a service per file or describe with `test.use({ geo: 'http-500' })` / `test.use({ search: 'offline' })`. The `app` fixture gives the page object (call `app.open()` first).

| Spec | Journey |
| --- | --- |
| `getting-started.spec.ts` | First visit opens in Edit; the library and the Explore / Edit choice survive a reload. |
| `building-a-repertoire.spec.ts` | Place moves (carry-to-place), delete a branch, record a segment in Pin mode, undo, write a note. |
| `training.spec.ts` | Explore: follow the repertoire, out-of-book moves snap back, no edit tools. |
| `navigating.spec.ts` | Step through lines, jump via the move line, overview, close / reopen boards. |
| `arranging-the-map.spec.ts` | Drag a board alone or with its branch, move it to a city. |
| `managing-maps.spec.ts` | Create, rename, switch, duplicate, flip and delete maps; persisted. |
| `sharing.spec.ts` | JSON / PGN export and import (and an invalid file), open in Lichess. |
| `touch.spec.ts` | Touch: tap-to-place with Place / Cancel, tapping a pin. |
| `resilience.spec.ts` | Corrupt stored library, geocoder down. |

**Keep it small.** One journey test per major feature; extra cases belong in the lower layers (see `AGENTS.md`, *E2E tests*). Transient tests while developing are fine, but don't leave them behind.

**Page objects** (`pages/`) own every selector and gesture: `ChessMapPage` (the `app` fixture) composes `TopBar`, `Board`, `MapView`, `Menu`, `Dialog` and `LocatePanel`, and holds the scenarios that cross components (`spawn`, `buildTwoLevels`, `snapshot`). Specs use `app.board.playMove(...)`, `app.map.enter()`, never raw `getByTestId`.

Prefer waiting on locators (`expect(...)`, `expect.poll`) over fixed sleeps; use `app.board.settled()` before reading the board's position. A `waitForTimeout` is acceptable only to check that something does not happen, with a comment saying so.

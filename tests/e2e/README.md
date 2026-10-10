# End-to-end tests (Playwright)

**Rule: e2e = user journeys.** Business rules belong in `tests/domain/`, side-effect orchestration in `tests/application/`, adapter error edge cases in `tests/infrastructure/secondary/`. An e2e test drives the real app in Chromium the way a person would and asserts what they see; it is the main coverage for the primary adapters and the wiring.

The network is mocked for every test by the auto fixture in `fixtures.ts` (tiles, Nominatim, Photon, lichess.org tabs). Any other external request fails the test. Override a service per file or describe with `test.use({ geo: 'http-500' })` / `test.use({ search: 'offline' })`. `helpers.ts` holds the small user-level helpers (`playMove`, `spawn`, `menu`, `settled`, ...).

| Spec | Journey |
| --- | --- |
| `getting-started.spec.ts` | First visit (empty repertoire opens in Edit), reloads keep the library and the Explore / Edit choice. |
| `building-a-repertoire.spec.ts` | Play moves, carry pins to place, record a segment in Pin mode, undo, delete a position, write notes. |
| `training.spec.ts` | Explore mode: follow the repertoire, out-of-book moves snap back, no edit tools. |
| `navigating.spec.ts` | Step through lines (keys, buttons, pins, the move line), close / reopen boards, centered mode, overview, transpositions, opening names. |
| `arranging-the-map.spec.ts` | Drag boards and branches, resize boards, set a location by city, go to a place. |
| `managing-maps.spec.ts` | Create, rename, flip, duplicate, switch and delete maps from the menu; all persisted. |
| `sharing.spec.ts` | JSON and PGN export / import (and their error messages), open in Lichess (URL, or clipboard for long lines). |
| `touch.spec.ts` | Touch flows: tap-to-place with Place / Cancel, tapping pins. |
| `resilience.spec.ts` | Geocoder or place search down, corrupt or unknown stored data. |

Prefer waiting on locators (`expect(...)`, `expect.poll`) over fixed sleeps; use `settled()` before reading the board's position. A `waitForTimeout` is acceptable only to check that something does not happen, with a comment saying so.

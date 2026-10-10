# Tests

Layout follows the layers of `docs/ARCHITECTURE.md` (see its "Testing strategy"):

| Path | What |
| --- | --- |
| `domain/` | Pure unit tests of the domain (`Session`, `Repertoire`, `Library`, rules, openings). Every business rule. No mocks. |
| `application/` | `ChessMapApp` against in-memory fakes of every port (`fakes.ts`): orchestration and side effects. |
| `infrastructure/secondary/` | Adapters against fake `fetch` / `Storage` / clipboard: formats, storage and migrations, geocoding, Lichess, error cases. |
| `infrastructure/primary/` | Only non-trivial pure presentation math (curves, spawn angles, view math, atom). The rest is covered by e2e. |
| `architecture.test.ts` | The dependency rules between layers. |
| `e2e/` | Playwright user journeys, see `e2e/README.md`. Run with `npm run e2e`. |

`npm test` runs everything except `e2e/` (Vitest); `npm run typecheck` also type-checks the tests.

# Chess Map

An opening "mind map": chess positions are pins on a world map (MapLibre). Play moves on a board placed on the map, drop markers around the world, and turn a repertoire into a set of journeys that is easier to remember. Maps are stored in localStorage and can be exported/imported as JSON.

## Run

    npm install
    npm run dev
    npm test           # vitest unit tests
    npm run typecheck
    npm run build
    npm run e2e        # Playwright tests (Chromium, network mocked); builds first

## Using it

- **Explore** is for training: enter pins and play moves from your repertoire. **Edit** (`E`) builds it: play a move and drop its pin on the map, or record a whole line into one board with **Pin** (`P`).
- Each position can have a note, a location (`L`) and right-click arrows and circles.
- **Overview** shows the whole tree faded; the top bar shows the current line and transpositions.
- **Keys:** `←` / `→` step through the line, `E`, `P`, `L`, `Ctrl+Z`, `Delete`, `Esc`.
- **Menu (⋮):** JSON and PGN import/export, open the current line in Lichess, several maps.

## Deploy

Pushes to `main` run `.github/workflows/deploy.yml`, which builds and publishes `dist` to GitHub Pages at https://mkalam-alami.github.io/chess-map/. In the repo settings, set Pages source to "GitHub Actions".

## Opening names

The opening and place labels above the board, and pin tooltips show the opening name for the current position, looked up by position (EPD) so transpositions are named too; out of book it shows the last named opening with a `+n` moves suffix. Data: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0 1.0), vendored as `src/infrastructure/secondary/openings/openings.json` and loaded lazily as a separate chunk. Regenerate with `node scripts/gen-openings.mjs` (needs network).

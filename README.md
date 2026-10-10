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

- **Explore** (default once a repertoire has moves) is for training: enter pins and play moves; anything outside the repertoire snaps back. A loaded repertoire opens as pins only.
- **Edit** (`E`, remembered between visits) builds it: play a move, then click the map to drop its pin. **Pin** (`P`) records a whole line into a single board instead; `Ctrl+Z` undoes the last recorded move. Recording a move that already starts the next board offers (after a confirmation) to pull it out of there and into the current board; a one-move board is absorbed, its note and place lost.
- Boards can be moved, resized (corner grip), closed (click or drag the bare map, or the × button) and deleted (`Delete`). On a small board the header collapses to a `…` menu.
- Each position can have a **note**, optionally pinned so it stays visible under its marker on the map, and a **location** (`L`, search by city).
- In Edit, **right-click** squares to draw circles and arrows (Shift / Alt for other colours). They are saved with the position, shown again whenever it is reached, and only removed with the eraser button next to the trash (it appears when there is something to clear); a left click on the board never erases them.
- **Overview** shows every position faded, shrinking with distance from the current one (all at the smallest size while no board is open); the top bar shows the current line (with the moves `→` would replay in a muted colour; they only exist after stepping back with `←` or by clicking an earlier marker or move, and playing a move forgets them) and points to transpositions.
- **Keys:** `←` / `→` step through the line (also the buttons beside the board), `E`, `P`, `L`, `Ctrl+Z`, `Delete`, `Esc`.
- **Menu (⋮):** JSON and PGN import/export (one map per game, positions, notes and arrows/circles travel in PGN comments), open the current line in Lichess, and a map switcher for several maps.

## Deploy

Pushes to `main` run `.github/workflows/deploy.yml`, which builds and publishes `dist` to GitHub Pages at https://mkalam-alami.github.io/chess-map/. In the repo settings, set Pages source to "GitHub Actions".

## Opening names

The opening and place labels above the board, and pin tooltips show the opening name for the current position, looked up by position (EPD) so transpositions are named too; out of book it shows the last named opening with a `+n` moves suffix. Data: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0 1.0), vendored as `src/infrastructure/secondary/openings/openings.json` and loaded lazily as a separate chunk. Regenerate with `node scripts/gen-openings.mjs` (needs network).

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

**Explore mode** (the default once a repertoire has moves; an empty one starts in Edit) is for training. Pan and zoom the map, enter pins, and play moves on the board: a move that exists in the repertoire follows it, anything else snaps back with "Not in repertoire".

**Edit mode** (button or `E`; the choice is remembered between visits; shown by an orange frame) builds the repertoire:
- Play a move on the board: a ghost pin follows the pointer; click the map to drop it (Esc cancels). On touch, drag or tap the ghost into place and press Place. The board stays, so you can add alternatives. Drag the board's handle bar or a pin to move it (Shift-drag or long-press-drag moves the whole subtree).
- **Board size:** boards have a size on the map and scale with the zoom. In Edit mode drag the corner grip (children inherit the size). Dragging past the screen limits zooms the map instead of stopping. Entering a pin zooms to its board's comfortable size, so small sub-boards zoom you into a region. Stepping with the arrow keys instead keeps the board the same size on screen.
- **Pin** (`P`) records moves into one pinned board instead: each move extends the same segment and the board advances. Branching mid-segment splits it. **Undo ply** (`Ctrl+Z` / `Backspace`) removes the last recorded ply of a leaf.
- Click a pin to enter it. The board header (Edit mode) has: the note icon (toggles editing the note, which is shown below the board with a pencil to edit it; `Enter`, `Esc` or clicking elsewhere closes the editor, `Shift+Enter` adds a line), set location, open in Lichess, a trash icon and a close button (hides the board; every board can be closed, then click its pin or use the arrow keys to bring it back). The trash icon in the board header or the `Delete` key removes the current position and everything below it. Every deletion asks first; press `Enter` to confirm, `Esc` to cancel. The external-link icon in the board header opens the current line in Lichess.
- **Overview** (on by default; toggle it in the top bar) shows every position faded; the further a position is from the current one (in moves), the smaller it gets: 1-2 moves away keep the full pin, 3-4 a plain dot without the move name, 5 or more a tiny dot (all in the player colour). Pins are light when White played the move and dark when Black did. A chip in the top bar points to other routes reaching the same position (transpositions).
- Set location by city (Edit mode): click the place label, the 📍 board button, or press `L`; preview results, then confirm. In Explore mode, "Go to place…" in the ⋮ menu just flies the map.

**Keys:** `←` / `→` step back/forward (also the on-screen buttons), `E` mode, `P` pin, `L` set location, `Ctrl+Z` undo ply, `Delete` delete position, `Esc` cancel placing/locating. Places are reverse-geocoded (Nominatim) when a node is placed.

**Menu (⋮):** export/import a map as JSON; export/import PGN (one map per game; node positions travel in `[%geo]` comments, notes as comments); **Open in Lichess** opens the current line in the analysis board, or copies the full PGN when the line is too long for a URL so you can paste it into a new study chapter. The map switcher handles several maps (new, rename, duplicate, flip orientation, delete).

## Deploy

Pushes to `main` run `.github/workflows/deploy.yml`, which builds and publishes `dist` to GitHub Pages at https://mkalam-alami.github.io/chess-map/. In the repo settings, set Pages source to "GitHub Actions".

## Opening names

The top bar (under the move line), and pin tooltips show the opening name for the current position, looked up by position (EPD) so transpositions are named too; out of book it shows the last named opening with a `+n` plies suffix. Data: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0 1.0), vendored as `src/chess/openings.json` and loaded lazily as a separate chunk. Regenerate with `node scripts/gen-openings.mjs` (needs network).

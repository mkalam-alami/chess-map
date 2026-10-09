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

**Explore mode (default)** is for training. Pan and zoom the map, enter pins, and play moves on the board: a move that exists in the repertoire follows it, anything else snaps back with "Not in repertoire".

**Edit mode** (button or `E`, shown by an orange frame) builds the repertoire:
- Play a move on the board: a ghost pin follows the pointer; click the map to drop it (Esc cancels). On touch, drag or tap the ghost into place and press Place. The board stays, so you can add alternatives. Drag the board's handle bar or a pin to move it (Shift-drag or long-press-drag moves the whole subtree).
- **Board size:** boards have a size on the map and scale with the zoom. In Edit mode use the corner grip or the -/+ buttons (steps of 0.25 in log2; children inherit). Dragging past the screen limits zooms the map instead of stopping. Entering a pin zooms to its board's comfortable size, so small sub-boards zoom you into a region.
- **Pin** (`P`) records moves into one pinned board instead: each move extends the same segment and the board advances. Branching mid-segment splits it. **Undo ply** (`Ctrl+Z` / `Backspace`) removes the last recorded ply of a leaf.
- Click a pin for Enter / Note / Delete (Delete asks for confirmation with the number of positions). Double-click enters it.
- **Overview** shows every position faded. A chip in the top bar points to other routes reaching the same position (transpositions).
- Set location by city (Edit mode): click the place label, the 📍 board button, "Set location…" in a pin popover, or press `L`; preview results, then confirm. In Explore mode, "Go to place…" in the ⋮ menu just flies the map.

**Keys:** `←` / `→` step back/forward (also the on-screen buttons), `E` mode, `P` pin, `L` set location, `Ctrl+Z` undo ply, `Esc` cancel placing/locating. Places are reverse-geocoded (Nominatim) when a node is placed.

**Menu (⋮):** export/import a map as JSON; export/import PGN (one map per game; node positions travel in `[%geo]` comments, notes as comments); **Open in Lichess** opens the current line in the analysis board, or copies the full PGN when the line is too long for a URL so you can paste it into a new study chapter. The map switcher handles several maps (new, rename, duplicate, flip orientation, delete).

## Deploy

Pushes to `main` run `.github/workflows/deploy.yml`, which builds and publishes `dist` to GitHub Pages at https://mkalam-alami.github.io/chess-map/. In the repo settings, set Pages source to "GitHub Actions".

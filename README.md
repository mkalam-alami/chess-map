# Chess Map

## Run

    npm install
    npm run dev        # camera needs a secure context: localhost or https
    npm test           # vitest unit tests
    npm run typecheck
    npm run build
    npm run e2e        # Playwright smoke test (Chromium, fake camera); builds first

Use the "Load file" input to feed an image or video instead of the camera. Toggle the debug panel with the corner button or a three-finger tap.

## Deploy

Pushes to `main` run `.github/workflows/deploy.yml`, which builds and publishes `dist` to GitHub Pages at https://mkalam-alami.github.io/chess-map/. In the repo settings, set Pages source to "GitHub Actions".

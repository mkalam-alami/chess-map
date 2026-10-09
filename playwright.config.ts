import { defineConfig } from '@playwright/test';

const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4173/chess-map/',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/chess-map/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

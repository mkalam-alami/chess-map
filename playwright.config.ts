import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, defineConfig } from '@playwright/test';

/**
 * CHROMIUM_PATH wins. Otherwise, if the Chromium build this Playwright version expects is not installed (pre-provisioned
 * machines ship another revision), fall back to any full Chromium found in PLAYWRIGHT_BROWSERS_PATH.
 */
function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync(chromium.executablePath())) return undefined;
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!dir || !existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse()
    .map((d) => join(dir, d, 'chrome-linux', 'chrome'))
    .find((p) => existsSync(p));
}

const executablePath = findChromium();

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

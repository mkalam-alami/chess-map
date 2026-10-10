import { expect, test as base } from '@playwright/test';
import { ChessMapPage } from './pages/ChessMapPage';

/**
 * Every e2e test runs against a fully mocked network, so tests can never hit a real service:
 * - tiles (OpenFreeMap), reverse geocoding (Nominatim) and place search (Photon) answer with canned data;
 * - lichess.org (tabs opened by the app) answers with a stub page;
 * - any other external request is aborted, and the test fails at the end naming the URL.
 * Routes are registered on the browser context so popups are covered too.
 */

/** How a mocked service answers. */
export type ServiceMode = 'ok' | 'http-500' | 'offline';

const STYLE = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#9bbbe8' } }] };

const NOMINATIM = { address: { city: 'Testville', country: 'Testland' } };
const PHOTON = {
  features: [
    {
      geometry: { coordinates: [-9.14, 38.72] },
      properties: { name: 'Lisbon', country: 'Portugal', extent: [-9.23, 38.80, -9.09, 38.69] },
    },
  ],
};

interface Options {
  /** Reverse geocoder (Nominatim). Override per file or describe with `test.use({ geo: 'http-500' })`. */
  geo: ServiceMode;
  /** Place search (Photon). */
  search: ServiceMode;
}

interface Fixtures {
  /** Auto fixture: installs the mocks and fails the test on any unexpected external request. */
  network: void;
  /** Page object of the app (not opened yet: call `app.open()`). */
  app: ChessMapPage;
}

const isLocal = (url: string): boolean => {
  const u = new URL(url);
  return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
};

export const test = base.extend<Options & Fixtures>({
  geo: ['ok', { option: true }],
  search: ['ok', { option: true }],

  app: async ({ page }, use) => use(new ChessMapPage(page)),

  network: [
    async ({ context, geo, search }, use) => {
      const unexpected: string[] = [];
      const answer = (mode: ServiceMode, body: unknown) => (route: import('@playwright/test').Route) =>
        mode === 'offline' ? route.abort('internetdisconnected') : mode === 'http-500' ? route.fulfill({ status: 500, body: 'boom' }) : route.fulfill({ json: body });

      // Later routes win: the catch-all comes first.
      await context.route(/^https?:\/\//, (route) => {
        const url = route.request().url();
        if (isLocal(url)) return route.fallback();
        unexpected.push(url);
        return route.abort('blockedbyclient');
      });
      await context.route('https://tiles.openfreemap.org/**', (route) =>
        route.request().url().includes('/styles/') ? route.fulfill({ json: STYLE }) : route.fulfill({ status: 204, body: '' }),
      );
      await context.route('https://nominatim.openstreetmap.org/**', answer(geo, NOMINATIM));
      await context.route('https://photon.komoot.io/**', answer(search, PHOTON));
      await context.route('https://lichess.org/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Lichess (stub)</title>' }),
      );

      await use();
      expect(unexpected, 'unexpected external requests (mock them in tests/e2e/fixtures.ts)').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

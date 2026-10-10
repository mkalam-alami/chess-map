import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/chess-map/',
  server: {
    // Dev only (see geoBase in src/main.ts): same-origin proxies for the public geocoding services.
    proxy: {
      '/chess-map/proxy/nominatim': { target: 'https://nominatim.openstreetmap.org', changeOrigin: true, rewrite: (p) => p.replace('/chess-map/proxy/nominatim', '') },
      '/chess-map/proxy/photon': { target: 'https://photon.komoot.io', changeOrigin: true, rewrite: (p) => p.replace('/chess-map/proxy/photon', '') },
    },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 12000 },
  test: {
    include: ['tests/**/*.test.ts'],
    fsModuleCache: true,
  },
});

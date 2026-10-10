// Renders the social preview (scripts/og-image.svg -> public/og-image.png, 1200x630)
// and the PNG app icons (public/favicon.svg -> apple-touch-icon / icon-192 / icon-512).
// Usage: node scripts/gen-og-image.mjs  (uses Playwright's Chromium; honours CHROMIUM_PATH)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function render(svg, size, path) {
  const page = await browser.newPage({ viewport: size });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.screenshot({ path, type: 'png', omitBackground: true });
  await page.close();
}

await render(read('./og-image.svg'), { width: 1200, height: 630 }, out('og-image.png'));
const icon = read('../public/favicon.svg');
for (const [name, px] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  await render(icon.replace('<svg ', `<svg width="${px}" height="${px}" `), { width: px, height: px }, out(name));
}
await browser.close();

import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

// Enforces the dependency rules of docs/ARCHITECTURE.md by reading every import in src/.

type Layer = 'domain' | 'application' | 'primary' | 'secondary' | 'main';

interface SourceFile { path: string; source: string }

const PRIMARY = 'src/infrastructure/primary';
const SECONDARY = 'src/infrastructure/secondary';

/** Which layer a repo-relative path (`src/...`) belongs to; null for files outside the layers. */
export function layerOf(path: string): Layer | null {
  if (path === 'src/main.ts') return 'main';
  if (path.startsWith('src/domain/')) return 'domain';
  if (path.startsWith('src/application/')) return 'application';
  if (path.startsWith(`${PRIMARY}/`)) return 'primary';
  if (path.startsWith(`${SECONDARY}/`)) return 'secondary';
  return null;
}

/** Every module specifier imported or re-exported by `source` (static, side-effect, `export … from` and dynamic `import()`). */
export function specifiersOf(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const out: string[] = [];
  const patterns = [
    /(?:^|[;{}\n])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|[;{}\n])\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) out.push(m[1] as string);
  return out;
}

const stripExt = (p: string): string => p.replace(/\.(d\.)?(tsx?|jsx?)$/, '');

/** A relative specifier resolved against the importing file, as a `src/...` path without extension. */
const resolve = (from: string, spec: string): string => stripExt(posix.join(posix.dirname(from), spec));

const isBarrel = (target: string, dir: string): boolean => target === dir || target === `${dir}/index`;
const inDir = (target: string, dir: string): boolean => target === dir || target.startsWith(`${dir}/`);
const isPackage = (spec: string, names: string[]): boolean => names.some((n) => spec === n || spec.startsWith(`${n}/`));

/** Rules per layer: which packages it may import, which asset types, and which layers (and how) it may reach. */
const RULES: Record<Exclude<Layer, 'main'>, { packages: string[]; assets: string[]; allows: (target: string) => boolean }> = {
  domain: { packages: ['chess.js'], assets: [], allows: (t) => inDir(t, 'src/domain') },
  application: {
    packages: [], assets: [],
    allows: (t) => inDir(t, 'src/application') || isBarrel(t, 'src/domain'),
  },
  primary: {
    packages: ['preact', 'maplibre-gl', 'chessground'], assets: ['.css'],
    allows: (t) => inDir(t, PRIMARY) || isBarrel(t, 'src/domain') || isBarrel(t, 'src/application'),
  },
  secondary: {
    packages: ['@mliebelt/pgn-parser'], assets: ['.json'],
    allows: (t) => inDir(t, SECONDARY) || isBarrel(t, 'src/domain') || isBarrel(t, 'src/application'),
  },
};

/** Human-readable violations (empty when the files respect the architecture). */
export function violations(files: SourceFile[]): string[] {
  const found: string[] = [];
  for (const { path, source } of files) {
    const layer = layerOf(path);
    if (!layer) {
      if (!/^src\/[^/]+\.d\.ts$/.test(path)) found.push(`${path}: not in a layer (domain, application, infrastructure/primary|secondary, main.ts)`);
      continue;
    }
    for (const spec of specifiersOf(source)) {
      if (!spec.startsWith('.')) {
        if (layer === 'main') continue;
        const rules = RULES[layer];
        if (!isPackage(spec, rules.packages)) found.push(`${path}: ${layer} may not import package "${spec}"`);
        continue;
      }
      const target = resolve(path, spec);
      if (layer === 'main') continue;
      const rules = RULES[layer];
      const asset = rules.assets.some((ext) => spec.endsWith(ext));
      if (!asset && !rules.allows(target)) found.push(`${path}: ${layer} may not import "${spec}" (${describeTarget(target)})`);
    }
  }
  return found.concat(barrelViolations(files));
}

/**
 * Outside a layer only its barrel is reachable (the secondary adapters have none: they are wired one by one in main.ts).
 * The per-layer rules already cover the adapters and the core, so this is what keeps the composition root honest.
 */
function barrelViolations(files: SourceFile[]): string[] {
  const barrels: [Layer, string][] = [['domain', 'src/domain'], ['application', 'src/application'], ['primary', PRIMARY]];
  const found: string[] = [];
  for (const { path, source } of files.filter((f) => layerOf(f.path) === 'main')) {
    for (const spec of specifiersOf(source).filter((s) => s.startsWith('.'))) {
      const target = resolve(path, spec);
      for (const [layer, dir] of barrels) {
        if (inDir(target, dir) && !isBarrel(target, dir)) found.push(`${path}: reaches into ${layer} ("${spec}"), use its barrel`);
      }
    }
  }
  return found;
}

const describeTarget = (target: string): string => (target.startsWith('src/') ? target : `outside src: ${target}`);

function readSources(dir: string): SourceFile[] {
  return (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[])
    .map((p) => p.split('\\').join('/'))
    .filter((p) => /\.(ts|tsx)$/.test(p))
    .map((p) => ({ path: `${dir}/${p}`, source: readFileSync(`${dir}/${p}`, 'utf8') }));
}

describe('architecture', () => {
  const files = readSources('src');

  it('scans every layer', () => {
    for (const layer of ['domain', 'application', 'primary', 'secondary', 'main'] as const) {
      expect(files.some((f) => layerOf(f.path) === layer), layer).toBe(true);
    }
  });

  it('respects the dependency rules of docs/ARCHITECTURE.md', () => {
    expect(violations(files)).toEqual([]);
  });

  it('has no source outside the layers', () => {
    expect(files.filter((f) => layerOf(f.path) === null && !f.path.endsWith('.d.ts'))).toEqual([]);
  });
});

describe('the checker', () => {
  const file = (path: string, source: string): SourceFile => ({ path, source });

  it('finds every kind of specifier', () => {
    const src = `
      import a from './a';
      import type { B } from "../b";
      import { c,
        d } from './c';
      import './side';
      export { e } from './e';
      export * from './f';
      const g = await import('./g');
      // import nope from './comment';
      /* import nope2 from './block'; */
    `;
    expect(specifiersOf(src)).toEqual(['./a', '../b', './c', './e', './f', './side', './g']);
  });

  it('accepts a conforming layout', () => {
    expect(violations([
      file('src/domain/session/Session.ts', "import { x } from '../geo'; import { Chess } from 'chess.js';"),
      file('src/application/ChessMapApp.ts', "import { Session } from '../domain';"),
      file('src/infrastructure/primary/map/mapView.ts', "import { Session } from '../../../domain'; import type { ChessMapApp } from '../../../application'; import maplibregl from 'maplibre-gl'; import 'maplibre-gl/dist/maplibre-gl.css';"),
      file('src/infrastructure/secondary/openings/Book.ts', "import type { OpeningBook } from '../../../application'; import('./openings.json');"),
      file('src/main.ts', "import { startPrimary } from './infrastructure/primary'; import { Book } from './infrastructure/secondary/openings/Book'; import './style.css';"),
    ])).toEqual([]);
  });

  it('flags a domain file importing the application, a package or the DOM layers', () => {
    const v = violations([
      file('src/domain/a.ts', "import { ChessMapApp } from '../application'; import maplibregl from 'maplibre-gl'; import x from './ok';"),
    ]);
    expect(v).toHaveLength(2);
    expect(v[0]).toContain('domain may not import "../application"');
    expect(v[1]).toContain('may not import package "maplibre-gl"');
  });

  it('flags the application reaching into domain internals or using a library', () => {
    const v = violations([
      file('src/application/a.ts', "import { Session } from '../domain/session/Session'; import { Chess } from 'chess.js';"),
    ]);
    expect(v).toHaveLength(2);
  });

  it('flags a dynamic import', () => {
    expect(violations([file('src/domain/a.ts', "const m = await import('../infrastructure/secondary/x');")])).toHaveLength(1);
  });

  it('flags primary and secondary adapters importing each other', () => {
    const v = violations([
      file('src/infrastructure/primary/ui/a.tsx', "import { Nominatim } from '../../secondary/geocoding/Nominatim';"),
      file('src/infrastructure/secondary/b.ts', "import { mountUi } from '../primary/ui/App';"),
    ]);
    expect(v.some((m) => m.startsWith('src/infrastructure/primary/ui/a.tsx') && m.includes('primary may not import'))).toBe(true);
    expect(v.some((m) => m.startsWith('src/infrastructure/secondary/b.ts') && m.includes('secondary may not import'))).toBe(true);
  });

  it('flags a UI library in a secondary adapter and a parser in a primary one', () => {
    const v = violations([
      file('src/infrastructure/secondary/a.ts', "import { render } from 'preact';"),
      file('src/infrastructure/primary/b.ts', "import { parse } from '@mliebelt/pgn-parser';"),
    ]);
    expect(v).toHaveLength(2);
  });

  it('flags a file outside the layers', () => {
    expect(violations([file('src/integration.ts', "import { app } from './store/store';")])).toEqual([
      'src/integration.ts: not in a layer (domain, application, infrastructure/primary|secondary, main.ts)',
    ]);
  });

  it('flags a primary file reaching into secondary', () => {
    const v = violations([
      file('src/infrastructure/primary/index.ts', "import { a } from '../secondary/x';"),
    ]);
    expect(v).toHaveLength(1);
  });

  it('lets main.ts see both adapter sets, but only through the barrels of the core and of primary', () => {
    expect(violations([file('src/main.ts', "import { startPrimary } from './infrastructure/primary/index'; import { ChessMapApp } from './application'; import { B } from './infrastructure/secondary/B';")])).toEqual([]);
    expect(violations([file('src/main.ts', "import { mountUi } from './infrastructure/primary/ui/App';")])).toHaveLength(1);
    expect(violations([file('src/main.ts', "import { ChessMapApp } from './application/ChessMapApp';")])).toHaveLength(1);
  });
});

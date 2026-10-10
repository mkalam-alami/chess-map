// One-off generator for src/infrastructure/secondary/openings/openings.json from lichess-org/chess-openings (CC0).
// Usage: node scripts/gen-openings.mjs   (needs network; the output is committed)
import { Chess } from 'chess.js';
import { writeFileSync } from 'node:fs';

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const out = {};
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const text = await (await fetch(`${BASE}${f}.tsv`)).text();
  for (const row of text.split('\n').slice(1)) {
    if (!row.trim()) continue;
    const [eco, name, pgn] = row.split('\t');
    const chess = new Chess();
    chess.loadPgn(pgn);
    const epd = chess.fen().split(' ').slice(0, 4).join(' ');
    out[epd] = [eco, name];
  }
}
writeFileSync(new URL('../src/infrastructure/secondary/openings/openings.json', import.meta.url), JSON.stringify(out));
console.log(Object.keys(out).length, 'positions');

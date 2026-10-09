import { Repertoire, type LngLat } from '../../../domain';
import type { MapFormat } from '../../../application';
import { exportPgn } from './pgn/export';
import { importPgn } from './pgn/import';

/** PGN with the layout in `[%geo]` comments: every game becomes a map, positions without one are placed automatically. */
export class PgnMapFormat implements MapFormat {
  readonly id = 'pgn';
  readonly extension = 'pgn';
  readonly mimeType = 'application/x-chess-pgn';

  write(map: Repertoire): string {
    return exportPgn(map.data);
  }

  read(text: string, ctx: { name: string; origin: LngLat }): Repertoire[] {
    return importPgn(text, { name: ctx.name.replace(/\.pgn$/i, ''), origin: ctx.origin }).map((m) => Repertoire.fromData(m));
  }
}

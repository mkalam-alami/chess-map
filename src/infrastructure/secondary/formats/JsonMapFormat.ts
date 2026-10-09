import type { Repertoire } from '../../../domain';
import type { MapFormat } from '../../../application';
import { deserializeMap, serializeMap } from '../storage/jsonCodec';

/** One map as a self-contained `.chessmap.json` file (imported under a fresh id). */
export class JsonMapFormat implements MapFormat {
  readonly id = 'json';
  readonly extension = 'chessmap.json';
  readonly mimeType = 'application/json';

  write(map: Repertoire): string {
    return serializeMap(map);
  }

  read(text: string): Repertoire[] {
    return [deserializeMap(text)];
  }
}

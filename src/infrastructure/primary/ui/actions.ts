import { ImportError, type ChessMapApp, type MapFormatId } from '../../../application';
import type { LngLat } from '../../../domain';
import { toast } from './toast';

/** Opens the current position in Lichess; tells the user when the PGN had to go to the clipboard instead. */
export function openInAnalysis(app: ChessMapApp): void {
  app.openInAnalysis().then(
    (outcome) => outcome === 'copied' && toast('PGN copied — paste it into a new study chapter'),
    () => toast('Could not copy the PGN to the clipboard'),
  );
}

/** Imports a picked file into the library; `origin` places maps that carry no positions. Reports the outcome as a toast. */
export async function importFile(app: ChessMapApp, format: MapFormatId, file: File, origin: LngLat): Promise<void> {
  try {
    const count = app.importMaps(format, await file.text(), { name: file.name, origin });
    toast(count > 1 ? `Imported ${count} maps` : 'Map imported');
  } catch (e) {
    toast(e instanceof ImportError ? e.message : `Could not import this ${format === 'pgn' ? 'PGN' : 'file'}`);
  }
}

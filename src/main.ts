import './style.css';
import { ChessMapApp } from './application';
import { startPrimary } from './infrastructure/primary';
import { DownloadFileSaver } from './infrastructure/secondary/browser/DownloadFileSaver';
import { JsonMapFormat } from './infrastructure/secondary/formats/JsonMapFormat';
import { PgnMapFormat } from './infrastructure/secondary/formats/PgnMapFormat';
import { NominatimReverseGeocoder } from './infrastructure/secondary/geocoding/NominatimReverseGeocoder';
import { PhotonPlaceSearch } from './infrastructure/secondary/geocoding/PhotonPlaceSearch';
import { LichessAnalysisBoard } from './infrastructure/secondary/lichess/LichessAnalysisBoard';
import { LichessOpeningBook } from './infrastructure/secondary/openings/LichessOpeningBook';
import { LocalStorageLibraryRepository } from './infrastructure/secondary/storage/LocalStorageLibraryRepository';
import { LocalStoragePreferences } from './infrastructure/secondary/storage/LocalStoragePreferences';
import { browserStorage } from './infrastructure/secondary/storage/kv';

// Composition root: the only place that knows both the primary and the secondary adapters.
const storage = browserStorage();
const pgn = new PgnMapFormat();

const app = new ChessMapApp({
  library: new LocalStorageLibraryRepository(storage),
  preferences: new LocalStoragePreferences(storage),
  geocoder: new NominatimReverseGeocoder(),
  placeSearch: new PhotonPlaceSearch(),
  openings: new LichessOpeningBook(),
  formats: { json: new JsonMapFormat(), pgn },
  files: new DownloadFileSaver(),
  analysis: new LichessAnalysisBoard({
    open: (url) => void window.open(url, '_blank', 'noopener'),
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    writePgn: (map) => pgn.write(map),
  }),
});

// Autosave is debounced: make sure the last change survives closing / reloading the tab.
window.addEventListener('pagehide', () => app.flush());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && app.flush());

// Load the stored library before any view reads the session; opening names and the root's place arrive later and notify.
void app.start();
startPrimary(document.getElementById('app') as HTMLElement, app);

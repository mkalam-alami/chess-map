import './style.css';
import { ChessMapApp } from './application';
import { startPrimary } from './infrastructure/primary';
import { DownloadFileSaver } from './infrastructure/secondary/browser/DownloadFileSaver';
import { JsonMapFormat } from './infrastructure/secondary/formats/JsonMapFormat';
import { PgnMapFormat } from './infrastructure/secondary/formats/PgnMapFormat';
import { NominatimReverseGeocoder } from './infrastructure/secondary/geocoding/NominatimReverseGeocoder';
import { PhotonPlaceSearch } from './infrastructure/secondary/geocoding/PhotonPlaceSearch';
import { GoogleDriveLibraryCloud, loadGoogleIdentity } from './infrastructure/secondary/googledrive/GoogleDriveLibraryCloud';
import { LocalStorageSyncState } from './infrastructure/secondary/googledrive/LocalStorageSyncState';
import { LichessAnalysisBoard } from './infrastructure/secondary/lichess/LichessAnalysisBoard';
import { LichessOpeningBook } from './infrastructure/secondary/openings/LichessOpeningBook';
import { LocalStorageLibraryRepository } from './infrastructure/secondary/storage/LocalStorageLibraryRepository';
import { LocalStoragePreferences } from './infrastructure/secondary/storage/LocalStoragePreferences';
import { browserStorage } from './infrastructure/secondary/storage/kv';

// Composition root: the only place that knows both the primary and the secondary adapters.
const storage = browserStorage();
const pgn = new PgnMapFormat();
// Dev server only: Firefox blocks the cross-origin geocoding requests from localhost, so go through the Vite proxy (vite.config.ts).
const geoBase = (service: string): { baseUrl?: string } => (import.meta.env.DEV ? { baseUrl: `${import.meta.env.BASE_URL}proxy/${service}` } : {});

// Opt-in Google Drive sync exists only in builds that have a client ID (VITE_GOOGLE_CLIENT_ID, public by design).
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

const app = new ChessMapApp({
  library: new LocalStorageLibraryRepository(storage),
  preferences: new LocalStoragePreferences(storage),
  geocoder: new NominatimReverseGeocoder(geoBase('nominatim')),
  placeSearch: new PhotonPlaceSearch(geoBase('photon')),
  openings: new LichessOpeningBook(),
  formats: { json: new JsonMapFormat(), pgn },
  files: new DownloadFileSaver(),
  analysis: new LichessAnalysisBoard({
    open: (url) => void window.open(url, '_blank', 'noopener'),
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    writePgn: (map) => pgn.write(map),
  }),
  ...(googleClientId && {
    cloud: { cloud: new GoogleDriveLibraryCloud({ clientId: googleClientId, loadIdentity: loadGoogleIdentity(), storage }), state: new LocalStorageSyncState(storage) },
  }),
});

// Autosave is debounced: make sure the last change survives closing / reloading the tab.
window.addEventListener('pagehide', () => app.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') app.flush();
  else app.cloudSync?.refresh();
});

// Load the stored library before any view reads the session; opening names and the root's place arrive later and notify.
void app.start();
startPrimary(document.getElementById('app') as HTMLElement, app);

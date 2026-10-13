import type { Cursor, Library, LngLat, Mode, Place, Repertoire } from '../../src/domain';
import {
  ChessMapApp, type CloudSync,
  type AnalysisBoard, type ChessMapPorts, type FileSaver, type LibraryCloud, type LibraryRepository, type MapFormat, type MapFormatId, type OpeningBook,
  type PlaceHit, type PlaceSearch, type PreferenceStore, type RemoteLibrary, type ReverseGeocoder, type SyncState, type SyncStateStore,
} from '../../src/application';

/** A promise the test settles by hand. */
export interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => undefined); // a rejection nobody awaits is not a test failure
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export class FakeLibraryRepository implements LibraryRepository {
  stored: Library | null = null;
  saved: Library[] = [];
  flushes = 0;
  load = (): Library | null => this.stored;
  save = (library: Library): void => void this.saved.push(library);
  flush = (): void => void this.flushes++;
}

export class FakePreferenceStore implements PreferenceStore {
  mode: Mode | null = null;
  saved: Mode[] = [];
  loadMode = (): Mode | null => this.mode;
  saveMode = (mode: Mode): void => void this.saved.push(mode);
}

/** What sync remembers; null = sync off. */
export class FakeSyncStateStore implements SyncStateStore {
  state: SyncState | null = null;
  load = (): SyncState | null => this.state;
  save = (state: SyncState | null): void => void (this.state = state);
}

/** A cloud with one slot. `pull` / `push` answer at once unless `failWith` is set; versions count up from 1. */
export class FakeLibraryCloud implements LibraryCloud {
  remote: RemoteLibrary | null = null;
  signedIn = false;
  /** What `resume` answers. */
  canResume = true;
  /** `connect` rejects with it. */
  declines: Error | null = null;
  /** `pull` and `push` reject with it. */
  failWith: Error | null = null;
  pulls = 0;
  pushes: Library[] = [];
  disconnects = 0;
  private versions = 0;
  /** Puts a library in the cloud, as another browser would. */
  setRemote(library: Library): string {
    const version = `v${++this.versions}`;
    this.remote = { library, version, modifiedAt: this.versions * 1000 };
    return version;
  }
  connect = async (): Promise<void> => {
    if (this.declines) throw this.declines;
    this.signedIn = true;
  };
  resume = async (): Promise<boolean> => (this.signedIn = this.canResume);
  disconnect = async (): Promise<void> => void (this.disconnects++, (this.signedIn = false));
  pull = async (): Promise<RemoteLibrary | null> => {
    this.pulls++;
    if (this.failWith) throw this.failWith;
    return this.remote;
  };
  push = async (library: Library): Promise<string> => {
    if (this.failWith) throw this.failWith;
    this.pushes.push(library);
    return this.setRemote(library);
  };
}

export interface GeocodeCall { at: LngLat; signal: AbortSignal; resolve: (p: Place | null) => void; reject: (e: unknown) => void }

/** Every lookup waits for the test: `calls[i].resolve(place)`. */
export class FakeReverseGeocoder implements ReverseGeocoder {
  calls: GeocodeCall[] = [];
  placeAt(at: LngLat, signal: AbortSignal): Promise<Place | null> {
    const d = deferred<Place | null>();
    this.calls.push({ at, signal, resolve: d.resolve, reject: d.reject });
    return d.promise;
  }
}

export class FakePlaceSearch implements PlaceSearch {
  queries: { query: string; signal?: AbortSignal | undefined }[] = [];
  hits: PlaceHit[] = [];
  search(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
    this.queries.push({ query, signal });
    return Promise.resolve(this.hits);
  }
}

/** Names nothing until `finishLoading()`. */
export class FakeOpeningBook implements OpeningBook {
  names = new Map<string, { eco: string; name: string }>();
  loads = 0;
  private loading = deferred<void>();
  private ready = false;
  load(): Promise<void> {
    this.loads++;
    return this.loading.promise;
  }
  lookup = (epd: string) => (this.ready ? this.names.get(epd) : undefined);
  finishLoading(): void {
    this.ready = true;
    this.loading.resolve();
  }
  failLoading(e: unknown = new Error('chunk failed')): void {
    this.loading.reject(e);
  }
}

export class FakeMapFormat implements MapFormat {
  written: Repertoire[] = [];
  reads: { text: string; ctx: { name: string; origin: LngLat } }[] = [];
  output = 'FILE CONTENT';
  /** What `read` returns, or throws when it is an Error. */
  result: Repertoire[] | Error = [];
  constructor(readonly id: MapFormatId, readonly extension: string, readonly mimeType: string) {}
  write(map: Repertoire): string {
    this.written.push(map);
    return this.output;
  }
  read(text: string, ctx: { name: string; origin: LngLat }): Repertoire[] {
    this.reads.push({ text, ctx });
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

export class FakeFileSaver implements FileSaver {
  saved: { filename: string; content: string; mimeType: string }[] = [];
  save = (filename: string, content: string, mimeType: string): void => void this.saved.push({ filename, content, mimeType });
}

/** Opens nothing; the test settles each request. */
export class FakeAnalysisBoard implements AnalysisBoard {
  opened: { map: Repertoire; cursor: Cursor; result: Deferred<'opened' | 'copied'> }[] = [];
  open(map: Repertoire, cursor: Cursor): Promise<'opened' | 'copied'> {
    const result = deferred<'opened' | 'copied'>();
    this.opened.push({ map, cursor, result });
    return result.promise;
  }
}

export interface Fakes {
  library: FakeLibraryRepository;
  preferences: FakePreferenceStore;
  geocoder: FakeReverseGeocoder;
  placeSearch: FakePlaceSearch;
  openings: FakeOpeningBook;
  json: FakeMapFormat;
  pgn: FakeMapFormat;
  files: FakeFileSaver;
  analysis: FakeAnalysisBoard;
  cloud: FakeLibraryCloud;
  syncState: FakeSyncStateStore;
}

/** An app wired to in-memory fakes of every port (not started). */
export function makeApp(): Fakes & { app: ChessMapApp; sync: () => CloudSync } {
  const fakes: Fakes = {
    library: new FakeLibraryRepository(),
    preferences: new FakePreferenceStore(),
    geocoder: new FakeReverseGeocoder(),
    placeSearch: new FakePlaceSearch(),
    openings: new FakeOpeningBook(),
    json: new FakeMapFormat('json', 'chessmap.json', 'application/json'),
    pgn: new FakeMapFormat('pgn', 'pgn', 'application/x-chess-pgn'),
    files: new FakeFileSaver(),
    analysis: new FakeAnalysisBoard(),
    cloud: new FakeLibraryCloud(),
    syncState: new FakeSyncStateStore(),
  };
  const ports: ChessMapPorts = {
    library: fakes.library, preferences: fakes.preferences, geocoder: fakes.geocoder, placeSearch: fakes.placeSearch,
    openings: fakes.openings, formats: { json: fakes.json, pgn: fakes.pgn }, files: fakes.files, analysis: fakes.analysis,
    cloud: { cloud: fakes.cloud, state: fakes.syncState },
  };
  const app = new ChessMapApp(ports);
  /** The sync of the app (always configured in tests). */
  const sync = (): CloudSync => app.cloudSync as CloudSync;
  return { ...fakes, app, sync };
}

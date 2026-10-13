import type { Cursor, Library, LngLat, Mode, Place, Repertoire } from '../domain';

/** Where the library is kept between visits. Synchronous: it is a local store with an in-memory view. */
export interface LibraryRepository {
  /** The stored library; null when there is none or it is unreadable. */
  load(): Library | null;
  /** May be debounced: call `flush` to make sure the last save is written. */
  save(library: Library): void;
  flush(): void;
}

/** The remembered Explore / Edit preference. */
export interface PreferenceStore {
  loadMode(): Mode | null;
  saveMode(mode: Mode): void;
}

export interface ReverseGeocoder {
  /** The place at a position; null when nothing is there (e.g. open sea). Rejects on network errors or abort. */
  placeAt(at: LngLat, signal: AbortSignal): Promise<Place | null>;
}

export interface PlaceHit {
  label: string;
  lngLat: LngLat;
  bbox?: [west: number, south: number, east: number, north: number];
}

export interface PlaceSearch {
  /** Blank queries give no hits. Rejects on network errors or abort. */
  search(query: string, signal?: AbortSignal): Promise<PlaceHit[]>;
}

export interface OpeningBook {
  /** Loads the data (lazily, once); `lookup` finds nothing before it resolves. */
  load(): Promise<void>;
  /** EPD (FEN fields 1-4) -> named position. */
  lookup(epd: string): { eco: string; name: string } | undefined;
}

export type MapFormatId = 'json' | 'pgn';

/** A file format a map can be exported to and imported from. */
export interface MapFormat {
  id: MapFormatId;
  /** Without the dot; may contain dots (`chessmap.json`). */
  extension: string;
  mimeType: string;
  write(map: Repertoire): string;
  /** One repertoire per game / map in the text. `origin` places maps that carry no positions. Throws ImportError. */
  read(text: string, ctx: { name: string; origin: LngLat }): Repertoire[];
}

export interface FileSaver {
  save(filename: string, content: string, mimeType: string): void;
}

export interface AnalysisBoard {
  /** 'opened': the position was opened directly; 'copied': the PGN went to the clipboard. Rejects when the clipboard fails. */
  open(map: Repertoire, cursor: Cursor): Promise<'opened' | 'copied'>;
}

/** What cloud sync remembers between visits; it exists exactly while sync is enabled. */
export interface SyncState {
  /** The cloud copy's version the local library was last in sync with; null before the first sync. */
  version: string | null;
  /** The local library changed since then. */
  dirty: boolean;
}

export interface SyncStateStore {
  load(): SyncState | null;
  /** Null when sync is turned off. */
  save(state: SyncState | null): void;
}

/** The library as stored in the cloud; `version` changes whenever someone writes it (opaque, only compared for equality). */
export interface RemoteLibrary {
  library: Library;
  version: string;
}

/** One private copy of the library in the user's own cloud storage, for keeping browsers in sync. */
export interface LibraryCloud {
  /** Signs in; opens a consent window, so call it from a user gesture. Rejects when declined. */
  connect(): Promise<void>;
  /** Signs in again without any window. False when that needs the user (then call `connect`). */
  resume(): Promise<boolean>;
  /** Signs out and revokes the access. Never rejects. */
  disconnect(): Promise<void>;
  /** The cloud copy; null when there is none yet. Rejects with `CloudAuthError` when signed out, or on any other failure. */
  pull(): Promise<RemoteLibrary | null>;
  /** Replaces the cloud copy and returns its new version. Rejects like `pull`. */
  push(library: Library): Promise<string>;
}

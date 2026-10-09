import type { Library } from '../../../domain';
import type { LibraryRepository } from '../../../application';
import { deserializeLibrary, serializeLibrary } from './jsonCodec';
import type { KV } from './kv';

export const STORAGE_KEY = 'chess-map:library';
export const CORRUPT_KEY = `${STORAGE_KEY}:corrupt`;

/** Keeps the library in `localStorage`; saves are debounced and only the latest library is written. */
export class LocalStorageLibraryRepository implements LibraryRepository {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Library | undefined;

  /** `storage` undefined = unavailable: nothing is loaded or saved. */
  constructor(private readonly storage: KV | undefined, private readonly delayMs = 400) {}

  /** Null when nothing is stored or the data is invalid (invalid data is kept under `CORRUPT_KEY`). */
  load(): Library | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      try {
        return deserializeLibrary(raw);
      } catch (e) {
        console.warn('Stored library is invalid', e);
        this.storage.setItem(CORRUPT_KEY, raw);
        return null;
      }
    } catch {
      return null; // storage threw: behave as if empty
    }
  }

  save(library: Library): void {
    this.pending = library;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Writes the pending library immediately. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const library = this.pending;
    this.pending = undefined;
    if (!library || !this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, serializeLibrary(library));
    } catch (e) {
      console.warn('Could not save library', e);
    }
  }
}

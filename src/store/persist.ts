import { deserializeLibrary, serializeLibrary } from '../model/serialize';
import type { Library } from '../model/types';

export const STORAGE_KEY = 'chess-map:library';

export type KV = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStorage = (): KV | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** Returns null when nothing is stored or the data is invalid (invalid data is kept under `${STORAGE_KEY}:corrupt`). */
export function loadLibrary(storage: KV | undefined = defaultStorage()): Library | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    try {
      return deserializeLibrary(raw);
    } catch (e) {
      console.warn('Stored library is invalid', e);
      storage.setItem(`${STORAGE_KEY}:corrupt`, raw);
      return null;
    }
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: { lib: Library; storage: KV | undefined } | undefined;

/** Writes the pending library immediately. */
export function flushSave(): void {
  clearTimeout(timer);
  timer = undefined;
  const job = pending;
  pending = undefined;
  if (!job?.storage) return;
  try {
    job.storage.setItem(STORAGE_KEY, serializeLibrary(job.lib));
  } catch (e) {
    console.warn('Could not save library', e);
  }
}

/** Debounced autosave; only the latest library is written. */
export function saveLibrary(lib: Library, storage: KV | undefined = defaultStorage(), delayMs = 400): void {
  pending = { lib, storage };
  clearTimeout(timer);
  timer = setTimeout(flushSave, delayMs);
}

const MODE_KEY = 'chess-map:mode';

/** The remembered Explore / Edit preference, or null when none (or storage is unavailable). */
export function loadMode(storage: KV | undefined = defaultStorage()): 'explore' | 'edit' | null {
  try {
    const v = storage?.getItem(MODE_KEY);
    return v === 'explore' || v === 'edit' ? v : null;
  } catch {
    return null;
  }
}

export function saveMode(mode: 'explore' | 'edit', storage: KV | undefined = defaultStorage()): void {
  try {
    storage?.setItem(MODE_KEY, mode);
  } catch {
    /* storage full or blocked: the preference just is not remembered */
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Library, Repertoire } from '../../../src/domain';
import { CORRUPT_KEY, LocalStorageLibraryRepository, STORAGE_KEY } from '../../../src/infrastructure/secondary/storage/LocalStorageLibraryRepository';
import { LocalStoragePreferences, MODE_KEY } from '../../../src/infrastructure/secondary/storage/LocalStoragePreferences';
import { browserStorage, type KV } from '../../../src/infrastructure/secondary/storage/kv';
import { serializeLibrary } from '../../../src/infrastructure/secondary/storage/jsonCodec';
import { libraryOf, pinnedOf } from '../../domain/fixtures';

const fakeStorage = () => {
  const data = new Map<string, string>();
  const store: KV & { data: Map<string, string>; sets: number } = {
    data, sets: 0,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { store.sets++; data.set(k, v); },
  };
  return store;
};

/** Storage whose operations throw (blocked site data, quota exceeded). */
const throwing = (on: { get?: boolean; set?: boolean }): KV => ({
  getItem: () => { if (on.get) throw new Error('SecurityError'); return null; },
  setItem: () => { if (on.set) throw new DOMException('full', 'QuotaExceededError'); },
});

const lib = (): Library => libraryOf(pinnedOf(['e4', 'e5']).session.repertoire);
const another = (): Library => libraryOf(Repertoire.create('Other', 'black', [1, 2]));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LocalStorageLibraryRepository', () => {
  it('saves after the debounce delay and loads what was saved', () => {
    const s = fakeStorage();
    const repo = new LocalStorageLibraryRepository(s, 400);
    const l = lib();
    repo.save(l);
    expect(s.data.has(STORAGE_KEY)).toBe(false);
    vi.advanceTimersByTime(399);
    expect(s.data.has(STORAGE_KEY)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(repo.load()?.data).toEqual(l.data);
  });

  it('only the latest library is written, once', () => {
    const s = fakeStorage();
    const repo = new LocalStorageLibraryRepository(s, 400);
    repo.save(lib());
    vi.advanceTimersByTime(300);
    const last = another();
    repo.save(last);
    vi.advanceTimersByTime(300);
    expect(s.sets).toBe(0); // the second save restarted the delay
    vi.advanceTimersByTime(100);
    expect(s.sets).toBe(1);
    expect(s.data.get(STORAGE_KEY)).toBe(serializeLibrary(last));
  });

  it('flush writes immediately, and only once', () => {
    const s = fakeStorage();
    const repo = new LocalStorageLibraryRepository(s, 10_000);
    const l = lib();
    repo.save(l);
    repo.flush();
    expect(s.data.get(STORAGE_KEY)).toBe(serializeLibrary(l));
    repo.flush();
    vi.advanceTimersByTime(20_000);
    expect(s.sets).toBe(1);
  });

  it('flush with nothing pending writes nothing', () => {
    const s = fakeStorage();
    new LocalStorageLibraryRepository(s).flush();
    expect(s.sets).toBe(0);
  });

  it('loads null when nothing is stored', () => {
    expect(new LocalStorageLibraryRepository(fakeStorage()).load()).toBeNull();
  });

  it.each([['broken JSON', '{oops'], ['valid JSON of the wrong shape', '{"version":1,"maps":[],"activeMapId":"x"}'], ['a newer version', '{"version":99}']])(
    'keeps %s under the corrupt key and loads null',
    (_, stored) => {
      const s = fakeStorage();
      s.data.set(STORAGE_KEY, stored);
      expect(new LocalStorageLibraryRepository(s).load()).toBeNull();
      expect(s.data.get(CORRUPT_KEY)).toBe(stored);
      expect(s.data.get(STORAGE_KEY)).toBe(stored); // not dropped either
    },
  );

  it('loads null when reading throws', () => {
    expect(new LocalStorageLibraryRepository(throwing({ get: true })).load()).toBeNull();
  });

  it('loads null when even keeping the corrupt copy fails (quota)', () => {
    const s = fakeStorage();
    s.data.set(STORAGE_KEY, '{oops');
    const full: KV = { getItem: s.getItem, setItem: throwing({ set: true }).setItem };
    expect(new LocalStorageLibraryRepository(full).load()).toBeNull();
  });

  it('swallows write failures (quota) and keeps working', () => {
    const repo = new LocalStorageLibraryRepository(throwing({ set: true }));
    repo.save(lib());
    expect(() => repo.flush()).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });

  it('does nothing without storage', () => {
    const repo = new LocalStorageLibraryRepository(undefined);
    expect(repo.load()).toBeNull();
    repo.save(lib());
    expect(() => repo.flush()).not.toThrow();
    vi.advanceTimersByTime(1000);
  });
});

describe('LocalStoragePreferences', () => {
  it('remembers the mode', () => {
    const s = fakeStorage();
    const prefs = new LocalStoragePreferences(s);
    expect(prefs.loadMode()).toBeNull();
    prefs.saveMode('edit');
    expect(s.data.get(MODE_KEY)).toBe('edit');
    expect(prefs.loadMode()).toBe('edit');
    prefs.saveMode('explore');
    expect(prefs.loadMode()).toBe('explore');
  });

  it('ignores unknown stored values', () => {
    const s = fakeStorage();
    s.data.set(MODE_KEY, 'creative');
    expect(new LocalStoragePreferences(s).loadMode()).toBeNull();
  });

  it('survives storage that throws or is unavailable', () => {
    for (const storage of [throwing({ get: true, set: true }), undefined]) {
      const prefs = new LocalStoragePreferences(storage);
      expect(() => prefs.saveMode('edit')).not.toThrow();
      expect(prefs.loadMode()).toBeNull();
    }
  });
});

describe('browserStorage', () => {
  it('is undefined when there is no localStorage, or reading the accessor throws', () => {
    expect(browserStorage()).toBeUndefined(); // node: no localStorage
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    expect(browserStorage()).toBeUndefined();
    delete (globalThis as Record<string, unknown>).localStorage;
  });
});

import { DEFAULT_CENTER } from '../geo';
import { Repertoire } from '../repertoire/Repertoire';
import { LIBRARY_VERSION, type LibraryData, type MapId } from '../repertoire/types';

/** The set of maps and which one is active. Immutable; there is always at least one map. */
export class Library {
  private cached?: LibraryData;

  private constructor(private readonly reps: ReadonlyMap<MapId, Repertoire>, readonly activeId: MapId) {}

  /** A library holding just `repertoire`, which is active. */
  static of(repertoire: Repertoire): Library {
    return new Library(new Map([[repertoire.id, repertoire]]), repertoire.id);
  }

  /** The library a first-time user starts with: one empty white repertoire. */
  static initial(): Library {
    return Library.of(Repertoire.create('My repertoire', 'white', DEFAULT_CENTER));
  }

  /** Wraps already validated data (secondary adapters validate before calling this). */
  static fromData(data: LibraryData): Library {
    const reps = new Map(Object.entries(data.maps).map(([id, map]) => [id, Repertoire.fromData(map)] as const));
    if (!reps.has(data.activeMapId)) throw new Error(`Unknown active map ${data.activeMapId}`);
    return new Library(reps, data.activeMapId);
  }

  /** The plain persisted shape (same object on every call). */
  get data(): LibraryData {
    this.cached ??= {
      version: LIBRARY_VERSION,
      maps: Object.fromEntries([...this.reps].map(([id, r]) => [id, r.data])),
      activeMapId: this.activeId,
    };
    return this.cached;
  }

  get active(): Repertoire { return this.reps.get(this.activeId) as Repertoire; }
  get size(): number { return this.reps.size; }
  ids(): MapId[] { return [...this.reps.keys()]; }
  repertoires(): Repertoire[] { return [...this.reps.values()]; }
  has(id: MapId): boolean { return this.reps.has(id); }
  /** Throws on unknown ids: use `has` to test. */
  get(id: MapId): Repertoire {
    const r = this.reps.get(id);
    if (!r) throw new Error(`Unknown map ${id}`);
    return r;
  }

  /** Adds (or replaces, same id) a map and makes it active. */
  add(repertoire: Repertoire): Library {
    return new Library(new Map(this.reps).set(repertoire.id, repertoire), repertoire.id);
  }

  /** Makes another map active; this when the id is unknown. */
  activate(id: MapId): Library {
    return this.reps.has(id) ? new Library(this.reps, id) : this;
  }

  /** Replaces a map (by its id) without changing the active one. Throws on unknown maps. */
  update(repertoire: Repertoire): Library {
    this.get(repertoire.id);
    return new Library(new Map(this.reps).set(repertoire.id, repertoire), this.activeId);
  }

  /** Removes a map; the first remaining one becomes active if it was the active one. Refused (this) for the last map or unknown ids. */
  remove(id: MapId): Library {
    if (this.reps.size <= 1 || !this.reps.has(id)) return this;
    const reps = new Map(this.reps);
    reps.delete(id);
    return new Library(reps, id === this.activeId ? (reps.keys().next().value as MapId) : this.activeId);
  }
}

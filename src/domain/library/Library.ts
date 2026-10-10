import { DEFAULT_CENTER } from '../geo';
import { Repertoire } from '../repertoire/Repertoire';
import { LIBRARY_VERSION, type LibraryData, type MapId } from '../repertoire/types';

/** Package-private: lets `library/commands.ts` build instances without a public constructor. Not in the domain barrel. */
export const internals = {} as { build: (reps: ReadonlyMap<MapId, Repertoire>, activeId: MapId) => Library };

/**
 * The set of maps and which one is active. Immutable and read-only: it only answers queries. Maps are added, switched
 * and removed through `Session` actions (which apply the package-private `library/commands.ts`).
 */
export class Library {
  private cached?: LibraryData;

  static { internals.build = (reps, activeId) => new Library(reps, activeId); }

  private constructor(private readonly reps: ReadonlyMap<MapId, Repertoire>, readonly activeId: MapId) {}

  /** The library a first-time user starts with: one empty white repertoire. */
  static initial(): Library {
    const rep = Repertoire.create('My repertoire', 'white', DEFAULT_CENTER);
    return new Library(new Map([[rep.id, rep]]), rep.id);
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
}

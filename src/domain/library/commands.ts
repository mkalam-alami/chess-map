import type { MapId } from '../repertoire/types';
import type { Repertoire } from '../repertoire/Repertoire';
import { internals, type Library } from './Library';

// Package-private building blocks of `Session` (not in the domain barrel). Each returns a new Library.

const repsOf = (lib: Library): Map<MapId, Repertoire> => new Map(lib.repertoires().map((r) => [r.id, r] as const));

/** A library holding just `repertoire`, which is active. */
export const libraryOf = (repertoire: Repertoire): Library => internals.build(new Map([[repertoire.id, repertoire]]), repertoire.id);

/** Adds (or replaces, same id) a map and makes it active. */
export const addMap = (lib: Library, repertoire: Repertoire): Library => internals.build(repsOf(lib).set(repertoire.id, repertoire), repertoire.id);

/** Makes another map active; `lib` itself when the id is unknown. */
export const activateMap = (lib: Library, id: MapId): Library => (lib.has(id) ? internals.build(repsOf(lib), id) : lib);

/** Replaces a map (by its id) without changing the active one. Throws on unknown maps. */
export function replaceMap(lib: Library, repertoire: Repertoire): Library {
  lib.get(repertoire.id);
  return internals.build(repsOf(lib).set(repertoire.id, repertoire), lib.activeId);
}

/** Removes a map; the first remaining one becomes active if it was the active one. Refused (`lib`) for the last map or unknown ids. */
export function removeMap(lib: Library, id: MapId): Library {
  if (lib.size <= 1 || !lib.has(id)) return lib;
  const reps = repsOf(lib);
  reps.delete(id);
  return internals.build(reps, id === lib.activeId ? (reps.keys().next().value as MapId) : lib.activeId);
}

import { useEffect, useReducer } from 'preact/hooks';
import { getState, subscribe, type State } from '../store/store';

type Subscribe = (fn: () => void) => () => void;

/** Re-renders the component whenever `subscribeTo` fires; `read` is compared to catch a change made before the effect ran. */
function useSubscription<T>(subscribeTo: Subscribe, read: () => T): T {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const value = read();
  useEffect(() => {
    if (read() !== value) bump(0);
    return subscribeTo(() => bump(0));
  }, []);
  return value;
}

/** The global store state; the component re-renders on every store change (views just re-read, see AGENTS.md). */
export const useStore = (): State => useSubscription(subscribe, getState);

/** Tiny observable cell for UI-only state that does not belong in the store (toast, popover, dialog, "openings loaded"). */
export interface Atom<T> {
  get: () => T;
  set: (v: T) => void;
  subscribe: Subscribe;
}

export function atom<T>(initial: T): Atom<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      value = v;
      for (const fn of [...subs]) fn();
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export const useAtom = <T,>(a: Atom<T>): T => useSubscription(a.subscribe, a.get);

/** Bumped when the lazily loaded opening table arrives, so names appear without a store change. */
export const openingsLoaded = atom(0);

import { createContext } from 'preact';
import { useContext, useEffect, useReducer } from 'preact/hooks';
import type { ChessMapApp } from '../../../application';
import type { ViewState } from '../viewState';

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

/** What the Preact tree needs from the outside: the application and the presentation state. Provided by `mountUi`. */
export const AppContext = createContext<{ app: ChessMapApp; view: ViewState } | null>(null);

function useServices(): { app: ChessMapApp; view: ViewState } {
  const services = useContext(AppContext);
  if (!services) throw new Error('AppContext is not provided');
  return services;
}

/** The application; the component re-renders on every application change (views just re-read, see AGENTS.md). */
export function useApp(): ChessMapApp {
  const { app } = useServices();
  useSubscription(app.subscribe.bind(app), () => app.session);
  return app;
}

/** The presentation state; the component re-renders when it (or the application) changes. */
export function useViewState(): ViewState {
  const { view } = useServices();
  useSubscription(view.subscribe.bind(view), () => view.state);
  return view;
}

/** Tiny observable cell for UI-only state that does not belong in the application (toast, popover, dialog). */
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

/** The part of `Storage` the adapters use. */
export type KV = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

/** `localStorage`, or undefined where it is unavailable (the accessor itself can throw when site data is blocked). */
export function browserStorage(): KV | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

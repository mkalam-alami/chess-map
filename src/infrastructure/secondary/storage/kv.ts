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

/** `sessionStorage` (lives as long as the tab), or undefined where it is unavailable. */
export function sessionStorageOrUndefined(): KV | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

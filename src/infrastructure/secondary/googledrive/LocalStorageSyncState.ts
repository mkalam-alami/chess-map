import type { SyncState, SyncStateStore } from '../../../application';
import type { KV } from '../storage/kv';

export const SYNC_KEY = 'chess-map:sync';

/** Remembers in `localStorage` that sync is on, and how far it got. Failures just mean sync is not remembered. */
export class LocalStorageSyncState implements SyncStateStore {
  constructor(private readonly storage: KV | undefined) {}

  load(): SyncState | null {
    try {
      const raw = this.storage?.getItem(SYNC_KEY);
      if (!raw) return null;
      const v: unknown = JSON.parse(raw);
      if (typeof v !== 'object' || v === null) return null;
      const { version, dirty } = v as Record<string, unknown>;
      if ((version !== null && typeof version !== 'string') || typeof dirty !== 'boolean') return null;
      return { version, dirty };
    } catch {
      return null;
    }
  }

  save(state: SyncState | null): void {
    try {
      if (state) this.storage?.setItem(SYNC_KEY, JSON.stringify(state));
      else this.storage?.removeItem?.(SYNC_KEY);
    } catch { /* storage full or blocked */ }
  }
}

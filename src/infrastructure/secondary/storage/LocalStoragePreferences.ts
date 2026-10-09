import type { Mode } from '../../../domain';
import type { PreferenceStore } from '../../../application';
import type { KV } from './kv';

export const MODE_KEY = 'chess-map:mode';

/** The remembered Explore / Edit preference in `localStorage`. Failures just mean nothing is remembered. */
export class LocalStoragePreferences implements PreferenceStore {
  constructor(private readonly storage: KV | undefined) {}

  loadMode(): Mode | null {
    try {
      const v = this.storage?.getItem(MODE_KEY);
      return v === 'explore' || v === 'edit' ? v : null;
    } catch {
      return null;
    }
  }

  saveMode(mode: Mode): void {
    try {
      this.storage?.setItem(MODE_KEY, mode);
    } catch {
      /* storage full or blocked: the preference just is not remembered */
    }
  }
}

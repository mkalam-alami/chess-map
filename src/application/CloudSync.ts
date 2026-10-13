import { CloudAuthError } from './errors';
import type { Library } from '../domain';
import type { LibraryCloud, RemoteLibrary, SyncState, SyncStateStore } from './ports';

/** What cloud sync needs from the app: kept this small so sync stays independent of `ChessMapApp`'s internals. */
export interface SyncHost {
  library(): Library;
  /** Swaps the whole library for the cloud's (the app saves it, restarts the session on it and notifies views). */
  replaceLibrary(library: Library): void;
  /** The sync status changed. */
  changed(): void;
}

export interface CloudSyncPorts {
  cloud: LibraryCloud;
  state: SyncStateStore;
}

/**
 * Where sync stands: `off` (not enabled), `reconnect` (enabled, the user has to sign in again), `synced`, `pending`
 * (local changes waiting for the debounced upload), `syncing`, `error` (last attempt failed, retried on the next change or
 * by hand) and `conflict` (both copies changed: the user picks one with `resolve`).
 */
export type SyncStatus = 'off' | 'reconnect' | 'synced' | 'pending' | 'syncing' | 'error' | 'conflict';

/** Local changes are uploaded this long after the last one. */
export const SYNC_DELAY_MS = 3000;
/** Coming back to the tab pulls remote changes, at most this often. */
export const SYNC_REFRESH_MS = 60_000;

/** A library nobody has built anything in (one empty map, like the initial one): safe to replace by a cloud copy. */
const isBlank = (library: Library): boolean =>
  library.repertoires().every((r) => r.node(r.rootId).children.length === 0);

/** The two sides of a `conflict`, for the user to choose from; times are ms since epoch, `local` null when unknown. */
export interface SyncConflict { local: number | null; remote: number }

/**
 * Opt-in sync of the library with one cloud copy. Off until `enable`; once enabled it is remembered (`SyncStateStore`) so
 * the next visit signs in silently and carries on. Each round pulls first: unchanged remote -> upload if we changed;
 * changed remote -> adopt it if we did not change, else it is a conflict. Failures never touch local data.
 */
export class CloudSync {
  private state: SyncState | null = null;
  private current: SyncStatus = 'off';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private run: Promise<void> | null = null;
  private again = false;
  private lastAt = 0;
  private open: SyncConflict | null = null;
  /** Counts `localChanged` calls, to spot changes made while an upload is in flight. */
  private changes = 0;

  constructor(private readonly ports: CloudSyncPorts, private readonly host: SyncHost) {}

  get status(): SyncStatus { return this.current; }

  /** What the user is choosing between while `status` is `conflict`. */
  get conflict(): SyncConflict | null { return this.current === 'conflict' ? this.open : null; }

  /** Picks sync up where the last visit left it. */
  start(): void {
    this.state = this.ports.state.load();
    if (!this.state) return;
    this.current = 'reconnect';
    void this.resume();
  }

  /** The app's library changed (not just the remembered viewport): the cloud is behind, upload shortly. */
  localChanged(): void {
    if (!this.state) return;
    this.changes++;
    if (!this.state.dirty) this.setState({ ...this.state, dirty: true, dirtySince: Date.now() });
    if (this.current === 'conflict' || this.current === 'reconnect') return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.reconcile(), SYNC_DELAY_MS);
    this.setStatus(this.current === 'syncing' ? 'syncing' : 'pending');
  }

  /**
   * Turns sync on (or signs in again after `reconnect`): opens the cloud's sign-in, so call it from a user gesture. Then
   * reconciles the two copies. Rejects when the sign-in is declined; later failures show in `status`.
   */
  async enable(): Promise<void> {
    await this.ports.cloud.connect();
    if (!this.state) this.setState({ version: null, dirty: !isBlank(this.host.library()) });
    await this.reconcile();
  }

  /** Turns sync off and signs out; the local library stays as it is. */
  async disable(): Promise<void> {
    clearTimeout(this.timer);
    this.setState(null);
    this.setStatus('off');
    await this.ports.cloud.disconnect();
  }

  /** Pulls and pushes now (nothing while sync is off or signed out). */
  now(): Promise<void> {
    return this.state && this.current !== 'reconnect' ? this.reconcile() : Promise.resolve();
  }

  /** Pulls remote changes when the user comes back to the tab, but not more often than every `SYNC_REFRESH_MS`. */
  refresh(at = Date.now()): void {
    if (this.current === 'synced' && at - this.lastAt >= SYNC_REFRESH_MS) void this.reconcile();
  }

  /** After a `conflict`: keeps this browser's copy (uploads it) or the cloud's (replaces the local library). */
  resolve(keep: 'local' | 'remote'): Promise<void> {
    return this.current === 'conflict' ? this.reconcile(keep) : Promise.resolve();
  }

  private setStatus(status: SyncStatus): void {
    if (status === this.current) return;
    this.current = status;
    this.host.changed();
  }

  private setState(state: SyncState | null): void {
    this.state = state;
    this.ports.state.save(state);
  }

  /** Startup: sign in silently; on success reconcile, otherwise ask the user to reconnect. */
  private async resume(): Promise<void> {
    try {
      if (await this.ports.cloud.resume()) return await this.reconcile();
    } catch { /* fall through */ }
    if (this.state) this.setStatus('reconnect');
  }

  /** One round at a time; a request that arrives meanwhile runs again afterwards. */
  private reconcile(choice?: 'local' | 'remote'): Promise<void> {
    if (this.run) {
      this.again = true;
      return this.run;
    }
    clearTimeout(this.timer);
    this.run = this.round(choice).finally(() => {
      this.run = null;
      if (this.again) {
        this.again = false;
        void this.reconcile();
      }
    });
    return this.run;
  }

  private async round(choice?: 'local' | 'remote'): Promise<void> {
    if (!this.state) return;
    this.setStatus('syncing');
    try {
      const remote = await this.ports.cloud.pull();
      const { version, dirty } = this.state;
      const remoteChanged = remote !== null && remote.version !== version;
      if (!remote || choice === 'local' || (!remoteChanged && dirty)) await this.upload();
      else if (choice === 'remote' || (remoteChanged && !dirty)) this.adopt(remote);
      else if (remoteChanged) {
        this.open = { local: this.state.dirtySince ?? null, remote: remote.modifiedAt };
        return this.setStatus('conflict');
      }
      this.lastAt = Date.now();
      if (this.current === 'syncing') this.setStatus('synced');
    } catch (e) {
      if (!(e instanceof CloudAuthError)) console.warn('Sync failed', e);
      this.setStatus(e instanceof CloudAuthError ? 'reconnect' : 'error');
    }
  }

  /** Uploads the current library; changes made during the upload keep it dirty and schedule another round. */
  private async upload(): Promise<void> {
    const at = this.changes;
    const version = await this.ports.cloud.push(this.host.library());
    const changedMeanwhile = this.changes !== at;
    this.setState({ version, dirty: changedMeanwhile });
    if (changedMeanwhile) this.again = true;
  }

  private adopt(remote: RemoteLibrary): void {
    this.host.replaceLibrary(remote.library);
    this.setState({ version: remote.version, dirty: false });
  }
}

import { CloudAuthError, type LibraryCloud, type RemoteLibrary } from '../../../application';
import type { Library } from '../../../domain';
import { deserializeLibrary, serializeLibrary } from '../storage/jsonCodec';

/** `drive.appdata`: a hidden folder only this app can see. Non-sensitive, so no Google security review is needed. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const FILE_NAME = 'chess-map-library.json';
const API = 'https://www.googleapis.com';

/** The part of Google Identity Services' token client the adapter uses. */
export interface TokenResponse { access_token?: string; expires_in?: number | string; error?: string }
export interface TokenClient { requestAccessToken(overrides?: { prompt?: string }): void }
export interface GoogleIdentity {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback: (e: { type?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}

export interface GoogleDriveDeps {
  clientId: string;
  /** Loads the Google Identity Services script (once) and returns its `google.accounts.oauth2`. */
  loadIdentity: () => Promise<GoogleIdentity>;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Tokens are renewed this long before they expire. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Keeps the library as one JSON file in the user's Google Drive app-data folder, using Google Identity Services' token
 * flow (no backend, no secret, no refresh token): the access token lives in memory only and is renewed silently
 * while the user's Google session and consent last. The cloud version is the file's `modifiedTime`.
 */
export class GoogleDriveLibraryCloud implements LibraryCloud {
  private token: { value: string; expiresAt: number } | null = null;
  private client: Promise<TokenClient> | null = null;
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
  private fileId: string | null = null;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly deps: GoogleDriveDeps) {
    this.doFetch = deps.fetch ?? ((...a) => fetch(...a));
    this.now = deps.now ?? Date.now;
  }

  async connect(): Promise<void> {
    await this.request('');
  }

  async resume(): Promise<boolean> {
    try {
      await this.request('none');
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    const token = this.token?.value;
    this.token = null;
    this.fileId = null;
    if (!token) return;
    try {
      const identity = await this.deps.loadIdentity();
      identity.revoke(token);
    } catch { /* offline: the token expires by itself */ }
  }

  async pull(): Promise<RemoteLibrary | null> {
    const file = await this.find();
    if (!file) return null;
    const res = await this.call(`/drive/v3/files/${file.id}?alt=media`);
    return { library: deserializeLibrary(await res.text()), version: file.modifiedTime };
  }

  async push(library: Library): Promise<string> {
    const body = serializeLibrary(library);
    const existing = this.fileId ? { id: this.fileId } : await this.find();
    if (existing) {
      const res = await this.call(`/upload/drive/v3/files/${existing.id}?uploadType=media&fields=id,modifiedTime`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
      });
      return ((await res.json()) as DriveFile).modifiedTime;
    }
    const boundary = `chessmap${this.now()}`;
    const metadata = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
      + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const res = await this.call('/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
    });
    const created = (await res.json()) as DriveFile;
    this.fileId = created.id;
    return created.modifiedTime;
  }

  /** The library file, if any (the newest one should another browser have created a second at the same time). */
  private async find(): Promise<DriveFile | null> {
    const q = encodeURIComponent(`name='${FILE_NAME}'`);
    const res = await this.call(`/drive/v3/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime desc&pageSize=1&fields=files(id,modifiedTime)`);
    const file = ((await res.json()) as { files?: DriveFile[] }).files?.[0] ?? null;
    this.fileId = file?.id ?? null;
    return file;
  }

  /** An authorized request; a refused token is dropped and reported as `CloudAuthError`. */
  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken();
    const res = await this.doFetch(`${API}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      this.token = null;
      throw new CloudAuthError('Google Drive refused the sign-in');
    }
    if (!res.ok) throw new Error(`Google Drive answered ${res.status}`);
    return res;
  }

  /** The cached token, or a new one requested without any window (rejects with `CloudAuthError` when that needs the user). */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - EXPIRY_MARGIN_MS > this.now()) return this.token.value;
    return this.request('none');
  }

  /** One token request at a time; `prompt` '' may open the consent window, 'none' never does. */
  private async request(prompt: '' | 'none'): Promise<string> {
    if (this.pending) throw new CloudAuthError('Sign-in already in progress');
    const client = await (this.client ??= this.deps.loadIdentity().then((id) => id.initTokenClient({
      client_id: this.deps.clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => this.onToken(r),
      error_callback: (e) => this.settle(new CloudAuthError(`Sign-in failed (${e.type ?? 'unknown'})`)),
    }))).catch((e: unknown) => {
      this.client = null; // script blocked or offline: try again next time
      throw e;
    });
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      client.requestAccessToken({ prompt });
    });
  }

  private onToken(r: TokenResponse): void {
    if (!r.access_token) return this.settle(new CloudAuthError(r.error ?? 'No access token'));
    this.token = { value: r.access_token, expiresAt: this.now() + Number(r.expires_in ?? 3600) * 1000 };
    this.settle(r.access_token);
  }

  private settle(result: string | Error): void {
    const p = this.pending;
    this.pending = null;
    if (typeof result === 'string') p?.resolve(result);
    else p?.reject(result);
  }
}

interface DriveFile { id: string; modifiedTime: string }

/** Loads Google's sign-in script once. Rejects when it cannot load (offline, blocked by a content blocker). */
export function loadGoogleIdentity(doc: Document = document): () => Promise<GoogleIdentity> {
  let loaded: Promise<GoogleIdentity> | null = null;
  return () => (loaded ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      const id = (globalThis as { google?: { accounts?: { oauth2?: GoogleIdentity } } }).google?.accounts?.oauth2;
      return id ? resolve(id) : reject(new Error('Google sign-in unavailable'));
    };
    script.onerror = () => reject(new Error('Could not load Google sign-in'));
    doc.head.append(script);
  }).catch((e: unknown) => {
    loaded = null;
    throw e;
  }));
}

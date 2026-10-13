import { describe, expect, it, vi } from 'vitest';
import { CloudAuthError } from '../../../src/application';
import {
  FILE_NAME, GoogleDriveLibraryCloud, type GoogleIdentity, type TokenResponse,
} from '../../../src/infrastructure/secondary/googledrive/GoogleDriveLibraryCloud';
import { serializeLibrary } from '../../../src/infrastructure/secondary/storage/jsonCodec';
import { libraryOf, treeOf } from '../../domain/fixtures';

const library = () => libraryOf(treeOf({ e4: {} }).session.repertoire);

/** A fake Google sign-in: `answer` decides what each token request gets. */
function setup(answer: (prompt: string) => TokenResponse | 'blocked' = () => ({ access_token: 'tok', expires_in: 3600 })) {
  const prompts: string[] = [];
  const revoked: string[] = [];
  const identity: GoogleIdentity = {
    initTokenClient: ({ callback, error_callback }) => ({
      requestAccessToken: (o) => {
        prompts.push(o?.prompt ?? '');
        const r = answer(o?.prompt ?? '');
        if (r === 'blocked') error_callback({ type: 'popup_failed_to_open' });
        else callback(r);
      },
    }),
    revoke: (t) => void revoked.push(t),
  };
  let now = 0;
  const fetchFn = vi.fn<typeof fetch>();
  const cloud = new GoogleDriveLibraryCloud({ clientId: 'cid', loadIdentity: async () => identity, fetch: fetchFn, now: () => now });
  return { cloud, fetchFn, prompts, revoked, tick: (ms: number) => void (now += ms) };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const urlOf = (c: unknown[]): string => String(c[0]);
const headerOf = (c: unknown[], name: string): string | null => new Headers((c[1] as RequestInit).headers).get(name);

describe('sign-in', () => {
  it('connect asks without forcing a prompt; resume never shows a window', async () => {
    const t = setup();
    await t.cloud.connect();
    expect(await t.cloud.resume()).toBe(true);
    expect(t.prompts).toEqual(['', 'none']);
  });

  it('resume is false when Google needs the user, and connect rejects when declined', async () => {
    const t = setup((p) => (p === 'none' ? { error: 'interaction_required' } : 'blocked'));
    expect(await t.cloud.resume()).toBe(false);
    await expect(t.cloud.connect()).rejects.toBeInstanceOf(CloudAuthError);
  });

  it('renews an expired token silently and reuses a valid one', async () => {
    const t = setup();
    t.fetchFn.mockImplementation(async () => json({ files: [] }));
    await t.cloud.pull();
    await t.cloud.pull();
    expect(t.prompts).toEqual(['none']);
    t.tick(3600_000);
    await t.cloud.pull();
    expect(t.prompts).toEqual(['none', 'none']);
  });

  it('disconnect revokes the token', async () => {
    const t = setup();
    await t.cloud.connect();
    await t.cloud.disconnect();
    expect(t.revoked).toEqual(['tok']);
  });
});

describe('pull', () => {
  it('is null when the app-data folder has no library', async () => {
    const t = setup();
    t.fetchFn.mockResolvedValue(json({ files: [] }));
    await t.cloud.connect();
    expect(await t.cloud.pull()).toBeNull();
    const call = t.fetchFn.mock.calls[0] as unknown[];
    expect(urlOf(call)).toContain('spaces=appDataFolder');
    expect(headerOf(call, 'Authorization')).toBe('Bearer tok');
  });

  it('downloads and parses the file, with its modified time as version', async () => {
    const t = setup();
    const lib = library();
    t.fetchFn
      .mockResolvedValueOnce(json({ files: [{ id: 'f1', modifiedTime: '2026-01-01T00:00:00Z' }] }))
      .mockResolvedValueOnce(new Response(serializeLibrary(lib)));
    const remote = await t.cloud.pull();
    expect(remote?.version).toBe('2026-01-01T00:00:00Z');
    expect(remote?.library.data).toEqual(lib.data);
    expect(urlOf(t.fetchFn.mock.calls[1] as unknown[])).toContain('/files/f1?alt=media');
  });

  it('rejects, rather than treating it as empty, when the stored file is invalid', async () => {
    const t = setup();
    t.fetchFn
      .mockResolvedValueOnce(json({ files: [{ id: 'f1', modifiedTime: 'x' }] }))
      .mockResolvedValueOnce(new Response('{"nope":1}'));
    await expect(t.cloud.pull()).rejects.toThrow();
  });
});

describe('push', () => {
  it('creates the file in the app-data folder when there is none', async () => {
    const t = setup();
    t.fetchFn
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ id: 'new', modifiedTime: 'T1' }));
    expect(await t.cloud.push(library())).toBe('T1');
    const call = t.fetchFn.mock.calls[1] as unknown[];
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(urlOf(call)).toContain('uploadType=multipart');
    const body = String((call[1] as RequestInit).body);
    expect(body).toContain(`"name":"${FILE_NAME}"`);
    expect(body).toContain('"parents":["appDataFolder"]');
  });

  it('updates the existing file, and remembers its id', async () => {
    const t = setup();
    t.fetchFn
      .mockResolvedValueOnce(json({ files: [{ id: 'f1', modifiedTime: 'T0' }] }))
      .mockResolvedValueOnce(json({ id: 'f1', modifiedTime: 'T1' }))
      .mockResolvedValueOnce(json({ id: 'f1', modifiedTime: 'T2' }));
    expect(await t.cloud.push(library())).toBe('T1');
    expect(await t.cloud.push(library())).toBe('T2');
    const second = t.fetchFn.mock.calls[2] as unknown[];
    expect((second[1] as RequestInit).method).toBe('PATCH');
    expect(urlOf(second)).toContain('/upload/drive/v3/files/f1?uploadType=media');
  });
});

describe('errors', () => {
  it('a 401 is an auth error and the token is dropped', async () => {
    const t = setup();
    t.fetchFn.mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValue(json({ files: [] }));
    await expect(t.cloud.pull()).rejects.toBeInstanceOf(CloudAuthError);
    await t.cloud.pull();
    expect(t.prompts).toEqual(['none', 'none']);
  });

  it('other HTTP failures are plain errors', async () => {
    const t = setup();
    t.fetchFn.mockResolvedValue(new Response('', { status: 500 }));
    const e = await t.cloud.pull().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(CloudAuthError);
  });
});

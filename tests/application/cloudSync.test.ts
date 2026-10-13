import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudAuthError } from '../../src/application';
import { SYNC_DELAY_MS, SYNC_REFRESH_MS } from '../../src/application';
import { Library, type NodeId } from '../../src/domain';
import { libraryOf, treeOf } from '../domain/fixtures';
import { makeApp } from './fakes';

const NAMED = { label: 'Paris', country: 'France' };

/** A named library with moves (e4 e5 / d4). */
function withMoves(): Library {
  const { session } = treeOf({ e4: { e5: {} }, d4: {} });
  return libraryOf(session.nameLocation(session.repertoire.rootId, NAMED).repertoire);
}
/** A different named library with moves. */
function otherMoves(): Library {
  const { session } = treeOf({ c4: {} });
  return libraryOf(session.nameLocation(session.repertoire.rootId, NAMED).repertoire);
}

/** A started app; `local` is the stored library (none = first visit). */
function started(local: Library | null = withMoves()) {
  const t = makeApp();
  t.library.stored = local;
  void t.app.start();
  return t;
}
const rootKids = (t: ReturnType<typeof makeApp>): NodeId[] => t.app.session.repertoire.node(t.app.session.repertoire.rootId).children;
const edit = (t: ReturnType<typeof makeApp>): void => void t.app.annotate(rootKids(t)[0] as NodeId, 'note');

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('availability', () => {
  it('is available with a cloud and starts off', () => {
    const t = started();
    expect(t.app.cloudSync !== undefined).toBe(true);
    expect(t.sync().status).toBe('off');
    expect(t.cloud.pulls).toBe(0);
  });
});

describe('enabling sync', () => {
  it('uploads the local library when the cloud has none, and remembers sync is on', async () => {
    const t = started();
    await t.sync().enable();
    expect(t.cloud.pushes).toEqual([t.app.session.library]);
    expect(t.sync().status).toBe('synced');
    expect(t.syncState.state).toEqual({ version: 'v1', dirty: false });
  });

  it('adopts the cloud copy when this browser has nothing of its own', async () => {
    const t = started(null);
    const remote = withMoves();
    t.cloud.setRemote(remote);
    await t.sync().enable();
    expect(t.app.session.library).toBe(remote);
    expect(t.library.saved.at(-1)).toBe(remote);
    expect(t.cloud.pushes).toEqual([]);
    expect(t.syncState.state).toEqual({ version: 'v1', dirty: false });
    expect(t.sync().status).toBe('synced');
  });

  it('is a conflict when both sides have content; nothing is overwritten', async () => {
    const t = started();
    const local = t.app.session.library;
    t.cloud.setRemote(otherMoves());
    await t.sync().enable();
    expect(t.sync().status).toBe('conflict');
    expect(t.app.session.library).toBe(local);
    expect(t.cloud.pushes).toEqual([]);
  });

  it('rejects when the sign-in is declined, leaving sync off', async () => {
    const t = started();
    t.cloud.declines = new Error('denied');
    await expect(t.sync().enable()).rejects.toThrow('denied');
    expect(t.sync().status).toBe('off');
    expect(t.syncState.state).toBeNull();
  });
});

describe('resolving a conflict', () => {
  async function conflicted() {
    const t = started();
    const remote = otherMoves();
    t.cloud.setRemote(remote);
    await t.sync().enable();
    return { t, remote };
  }

  it('tells when each side last changed', async () => {
    vi.setSystemTime(5_000_000);
    const t = started();
    await t.sync().enable();
    edit(t); // the local change is dated now
    t.cloud.setRemote(otherMoves()); // modified at 2000 ms (second version)
    await t.sync().now();
    expect(t.sync().status).toBe('conflict');
    expect(t.sync().conflict).toEqual({ local: 5_000_000, remote: 2000 });
    await t.sync().resolve('local');
    expect(t.sync().conflict).toBeNull();
  });

  it('local time is unknown for content that predates the first sync', async () => {
    const { t } = await conflicted();
    expect(t.sync().conflict).toEqual({ local: null, remote: 1000 });
  });

  it('keep local: uploads this browser\'s copy', async () => {
    const { t } = await conflicted();
    const local = t.app.session.library;
    await t.sync().resolve('local');
    expect(t.cloud.pushes).toEqual([local]);
    expect(t.sync().status).toBe('synced');
  });

  it('keep remote: replaces the local library', async () => {
    const { t, remote } = await conflicted();
    await t.sync().resolve('remote');
    expect(t.app.session.library).toBe(remote);
    expect(t.cloud.pushes).toEqual([]);
    expect(t.sync().status).toBe('synced');
  });

  it('does nothing when there is no conflict', async () => {
    const t = started();
    await t.sync().enable();
    await t.sync().resolve('remote');
    expect(t.cloud.pulls).toBe(1);
  });
});

describe('autosync', () => {
  async function synced() {
    const t = started();
    await t.sync().enable();
    t.cloud.pushes.length = 0;
    return t;
  }

  it('uploads a change after a quiet moment, and only the latest state', async () => {
    const t = await synced();
    edit(t);
    expect(t.sync().status).toBe('pending');
    expect(t.syncState.state?.dirty).toBe(true);
    t.app.annotate(rootKids(t)[0] as NodeId, 'again');
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS - 1);
    expect(t.cloud.pushes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.cloud.pushes).toEqual([t.app.session.library]);
    expect(t.sync().status).toBe('synced');
    expect(t.syncState.state?.dirty).toBe(false);
  });

  it('a change made during the upload is uploaded afterwards', async () => {
    const t = await synced();
    const push = t.cloud.push;
    let edited = false;
    t.cloud.push = async (lib) => {
      const v = await push(lib);
      if (!edited) edit(t); // the user edits once while the request is in flight
      edited = true;
      return v;
    };
    edit(t);
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS);
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS);
    expect(t.cloud.pushes).toHaveLength(2);
    expect(t.cloud.pushes.at(-1)).toBe(t.app.session.library);
  });

  it('pulls another browser\'s change when this one has none', async () => {
    const t = await synced();
    const remote = otherMoves();
    t.cloud.setRemote(remote);
    await t.sync().now();
    expect(t.app.session.library).toBe(remote);
  });

  it('is a conflict when both changed, and then does not upload on its own', async () => {
    const t = await synced();
    t.cloud.setRemote(otherMoves());
    edit(t);
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS);
    expect(t.sync().status).toBe('conflict');
    edit(t);
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS * 2);
    expect(t.cloud.pushes).toEqual([]);
  });

  it('keeps local data and retries on the next change after a failure', async () => {
    const t = await synced();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.cloud.failWith = new Error('offline');
    edit(t);
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS);
    expect(t.sync().status).toBe('error');
    expect(t.syncState.state?.dirty).toBe(true);
    t.cloud.failWith = null;
    t.app.annotate(rootKids(t)[0] as NodeId, 'later');
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS);
    expect(t.sync().status).toBe('synced');
    expect(t.cloud.pushes).toEqual([t.app.session.library]);
  });

  it('asks to reconnect when the cloud refuses the sign-in', async () => {
    const t = await synced();
    t.cloud.failWith = new CloudAuthError();
    edit(t);
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS);
    expect(t.sync().status).toBe('reconnect');
    edit(t);
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS * 2);
    expect(t.cloud.pushes).toEqual([]);
    expect(t.syncState.state?.dirty).toBe(true);
  });

  it('refreshes on return to the tab, at most once a minute', async () => {
    const t = await synced();
    t.sync().refresh(Date.now() + SYNC_REFRESH_MS - 1);
    expect(t.cloud.pulls).toBe(1);
    t.sync().refresh(Date.now() + SYNC_REFRESH_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.cloud.pulls).toBe(2);
  });
});

describe('next visit', () => {
  function restart(state: { version: string | null; dirty: boolean }, remote: Library | null) {
    const t = makeApp();
    t.library.stored = withMoves();
    t.syncState.state = state;
    if (remote) t.cloud.setRemote(remote);
    void t.app.start();
    return t;
  }

  it('signs in silently and pushes changes made before the page closed', async () => {
    const mine = withMoves();
    const t = makeApp();
    t.library.stored = mine;
    t.syncState.state = { version: 'v1', dirty: true };
    t.cloud.setRemote(otherMoves()); // version v1
    void t.app.start();
    expect(t.sync().status).toBe('reconnect');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.cloud.pushes).toEqual([mine]);
    expect(t.sync().status).toBe('synced');
  });

  it('adopts changes another browser made meanwhile', async () => {
    const remote = otherMoves();
    const t = restart({ version: 'v0', dirty: false }, remote);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.session.library).toBe(remote);
  });

  it('shows reconnect when a silent sign-in is not possible, and connecting fixes it', async () => {
    const t = makeApp();
    t.library.stored = withMoves();
    t.syncState.state = { version: null, dirty: true };
    t.cloud.canResume = false;
    void t.app.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sync().status).toBe('reconnect');
    expect(t.cloud.pulls).toBe(0);
    await t.sync().enable();
    expect(t.sync().status).toBe('synced');
    expect(t.cloud.pushes).toHaveLength(1);
  });

  it('ignores the stored state when sync is off or unavailable', () => {
    const t = restart({ version: null, dirty: false }, null);
    void t.sync().disable();
    expect(t.syncState.state).toBeNull();
  });
});

describe('disabling sync', () => {
  it('signs out, forgets the state and stops uploading, keeping local data', async () => {
    const t = started();
    await t.sync().enable();
    edit(t);
    const local = t.app.session.library;
    await t.sync().disable();
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS * 2);
    expect(t.cloud.disconnects).toBe(1);
    expect(t.syncState.state).toBeNull();
    expect(t.sync().status).toBe('off');
    expect(t.cloud.pushes).toHaveLength(1); // only the initial upload
    expect(t.app.session.library).toBe(local);
  });
});

describe('navigation', () => {
  it('a remembered viewport is saved locally but never marks the cloud copy as behind', async () => {
    const t = started();
    await t.sync().enable();
    t.app.rememberView({ center: [1, 2], zoom: 4 });
    expect(t.sync().status).toBe('synced');
    expect(t.syncState.state).toEqual({ version: 'v1', dirty: false });
    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS * 2);
    expect(t.cloud.pushes).toHaveLength(1);
  });
});

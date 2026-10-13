import type { ChessMapApp, SyncStatus } from '../../../application';
import { confirmDialog, formDialog } from './overlay';
import { toast } from './toast';

const LABELS: Record<SyncStatus, string> = {
  off: '', reconnect: 'Sign-in needed', synced: 'Up to date', pending: 'Changes waiting…', syncing: 'Syncing…', error: 'Last sync failed', conflict: 'Conflict',
};

/** "changed 13 Oct, 09:12", or "change time unknown". */
const changed = (at: number | null): string =>
  at === null ? 'change time unknown' : `changed ${new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;

/** When both copies changed, asks which one to keep. Cancelling leaves the conflict open (the menu offers it again). */
async function settleConflict(app: ChessMapApp): Promise<void> {
  const sync = app.cloudSync;
  const conflict = sync?.conflict;
  if (!sync || !conflict) return;
  const r = await formDialog('Sync conflict', [{
    name: 'keep', label: 'This browser and the cloud both have changes. Keep:', value: 'local',
    options: [
      ['local', `This browser (${changed(conflict.local)}) — replaces the cloud copy`],
      ['remote', `The cloud copy (${changed(conflict.remote)}) — replaces this browser`],
    ],
  }], 'Keep');
  if (r) await sync.resolve(r.keep === 'remote' ? 'remote' : 'local');
}

async function enable(app: ChessMapApp): Promise<void> {
  try {
    await app.cloudSync?.enable();
  } catch {
    return toast('Could not sign in');
  }
  await settleConflict(app);
  toast(app.cloudSync?.status === 'synced' ? 'Synced' : 'Sync is on');
}

async function syncNow(app: ChessMapApp): Promise<void> {
  await app.cloudSync?.now();
  await settleConflict(app);
  const status = app.cloudSync?.status;
  if (status === 'synced') toast('Synced');
  else if (status === 'error') toast('Sync failed, will retry on the next change');
  else if (status === 'reconnect') toast('Sign in again to sync');
}

function Item({ label, testid, close, run }: { label: string; testid: string; close: () => void; run: () => void | Promise<void> }) {
  return <button type="button" class="menu-item" data-testid={testid} onClick={() => { close(); void run(); }}>{label}</button>;
}

/**
 * The opt-in cloud sync entries of the menu (nothing when no cloud is configured). Self-contained: the menu only
 * renders it. Off: one entry to turn it on; on: the status and the few actions that make sense.
 */
export function SyncMenuSection({ app, close }: { app: ChessMapApp; close: () => void }) {
  const sync = app.cloudSync;
  if (!sync) return null;
  const status = sync.status;
  const item = (label: string, testid: string, run: () => void | Promise<void>) => <Item label={label} testid={testid} close={close} run={run} />;
  return (
    <>
      <div class="menu-label" data-testid="sync-status">{status === 'off' ? 'Sync' : `Sync · ${LABELS[status]}`}</div>
      {status === 'off' && item('Sync with Google Drive…', 'menu-sync-enable', () => enable(app))}
      {status === 'reconnect' && item('Sign in again…', 'menu-sync-enable', () => enable(app))}
      {status === 'conflict' && item('Resolve conflict…', 'menu-sync-resolve', () => settleConflict(app))}
      {status !== 'off' && status !== 'reconnect' && status !== 'conflict' && item('Sync now', 'menu-sync-now', () => syncNow(app))}
      {status !== 'off' && item('Turn off sync', 'menu-sync-disable', async () => {
        if (await confirmDialog('Stop syncing? Maps stay in this browser; the cloud copy is kept.', 'Turn off')) await sync.disable();
      })}
    </>
  );
}

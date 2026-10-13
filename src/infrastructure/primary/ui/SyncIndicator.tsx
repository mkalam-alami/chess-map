import { useEffect, useRef } from 'preact/hooks';
import type { SyncStatus } from '../../../application';
import { Icon } from './Icon';
import { useApp } from './hooks';
import { dismissToast, toast } from './toast';

const TITLES: Record<SyncStatus, string> = {
  off: '', reconnect: 'Sync paused: sign in again from the menu', synced: 'Synced', pending: 'Changes waiting to sync', syncing: 'Syncing…',
  error: 'Last sync failed, retrying on the next change', conflict: 'Sync conflict: resolve it from the menu',
};

/** What the toast says when the status becomes this one (none: the toast is hidden or left alone). */
const TOASTS: Partial<Record<SyncStatus, string>> = {
  syncing: 'Syncing…', synced: 'Synced', error: 'Sync failed, will retry on the next change', reconnect: 'Sync paused: sign in again from the menu',
  conflict: 'Sync conflict: open the menu to resolve it',
};

/**
 * Shows that cloud sync is on (a cloud in the top bar, with the status as its tooltip) and announces status changes
 * with the toast, "Syncing…" included. Nothing at all while sync is off or unavailable.
 */
export function SyncIndicator() {
  const status = useApp().cloudSync?.status ?? 'off';
  const previous = useRef<SyncStatus>(status);
  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (status === before || status === 'off') return;
    // Startup is not news: the first render already holds the initial status. A "Syncing…" that ends in 'pending' is dropped.
    const text = TOASTS[status];
    if (text) toast(text, status === 'syncing' ? 30_000 : 2200);
    else if (before === 'syncing') dismissToast();
  }, [status]);
  if (status === 'off') return null;
  return (
    <span class={`sync-indicator ${status}`} data-testid="sync-indicator" data-status={status} title={TITLES[status]} role="img" aria-label={TITLES[status]}>
      <Icon name="cloud" size={18} />
    </span>
  );
}

import { useEffect, useRef } from 'preact/hooks';
import type { SyncStatus } from '../../../application';
import { Icon } from './Icon';
import { useApp } from './hooks';
import { toast } from './toast';

const TITLES: Record<SyncStatus, string> = {
  off: '', reconnect: 'Sync paused: sign in again from the menu', synced: 'Synced', pending: 'Changes waiting to sync', syncing: 'Syncing…',
  error: 'Last sync failed, retrying on the next change', conflict: 'Sync conflict: resolve it from the menu',
};

/** What the toast says when the status becomes this one (none: the toast is hidden or left alone). */
const TOASTS: Partial<Record<SyncStatus, string>> = {
  error: 'Sync failed, will retry on the next change', reconnect: 'Sync paused: sign in again from the menu',
  conflict: 'Sync conflict: open the menu to resolve it',
};

/**
 * Shows that cloud sync is on (a cloud in the top bar, with the status as its tooltip). The toast only announces problems
 * and the first "Synced" after startup, sign-in or enabling sync; routine background syncs stay silent.
 * Nothing at all while sync is off or unavailable.
 */
export function SyncIndicator() {
  const status = useApp().cloudSync?.status ?? 'off';
  const previous = useRef<SyncStatus>(status);
  // True until the next "Synced" has been announced: set at startup, after sign-in is needed again, and when sync is off.
  const reassure = useRef(status === 'reconnect' || status === 'off');
  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (status === before) return;
    if (status === 'off' || status === 'reconnect') reassure.current = true;
    const text = status === 'synced' ? (reassure.current ? 'Synced' : undefined) : TOASTS[status];
    if (status === 'synced') reassure.current = false;
    if (text) toast(text, 2200);
  }, [status]);
  if (status === 'off') return null;
  return (
    <span class={`sync-indicator ${status}`} data-testid="sync-indicator" data-status={status} title={TITLES[status]} role="img" aria-label={TITLES[status]}>
      <Icon name="cloud" size={18} />
    </span>
  );
}

import { describe, expect, it } from 'vitest';
import { LocalStorageSyncState, SYNC_KEY } from '../../../src/infrastructure/secondary/googledrive/LocalStorageSyncState';

function kv(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

describe('LocalStorageSyncState', () => {
  it('round-trips and is forgotten when turned off', () => {
    const s = kv();
    const p = new LocalStorageSyncState(s);
    p.save({ version: 'T1', dirty: true });
    expect(p.load()).toEqual({ version: 'T1', dirty: true });
    p.save(null);
    expect(p.load()).toBeNull();
    expect(s.data.has(SYNC_KEY)).toBe(false);
  });

  it('keeps the time of the first local change', () => {
    const p = new LocalStorageSyncState(kv());
    p.save({ version: null, dirty: true, dirtySince: 1234 });
    expect(p.load()).toEqual({ version: null, dirty: true, dirtySince: 1234 });
  });

  it.each(['not json', '{"version":3,"dirty":true}', '{"version":"x"}', 'null'])('treats %s as not enabled', (raw) => {
    expect(new LocalStorageSyncState(kv({ [SYNC_KEY]: raw })).load()).toBeNull();
  });
});

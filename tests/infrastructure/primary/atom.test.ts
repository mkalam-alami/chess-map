import { describe, expect, it, vi } from 'vitest';
import { atom } from '../../../src/infrastructure/primary/ui/hooks';

describe('atom', () => {
  it('holds a value and notifies subscribers on set', () => {
    const a = atom(1);
    const fn = vi.fn();
    a.subscribe(fn);
    a.set(2);
    expect(a.get()).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const a = atom('x');
    const fn = vi.fn();
    a.subscribe(fn)();
    a.set('y');
    expect(fn).not.toHaveBeenCalled();
  });
});

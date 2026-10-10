import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadFileSaver } from '../../../src/infrastructure/secondary/browser/DownloadFileSaver';

describe('DownloadFileSaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clicks a temporary link to a blob of the content, then cleans up', async () => {
    const calls: string[] = [];
    const link = { href: '', download: '', click: () => calls.push('click'), remove: () => calls.push('remove') };
    const doc = { createElement: () => link, body: { append: () => calls.push('append') } } as unknown as Document;
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    new DownloadFileSaver(doc).save('My map.pgn', '1. e4 *', 'application/x-chess-pgn');

    expect(calls).toEqual(['append', 'click', 'remove']);
    expect(link).toMatchObject({ href: 'blob:fake', download: 'My map.pgn' });
    const blob = create.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/x-chess-pgn');
    expect(await blob.text()).toBe('1. e4 *');
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });
});

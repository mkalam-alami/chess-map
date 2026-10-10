import { describe, expect, it, vi } from 'vitest';
import { Repertoire } from '../../../src/domain';
import { flip } from '../../../src/domain/repertoire/commands';
import { LICHESS_STUDY_URL, LichessAnalysisBoard, MAX_URL, lichessAnalysisUrl } from '../../../src/infrastructure/secondary/lichess/LichessAnalysisBoard';
import { lineOf } from '../../domain/fixtures';

describe('lichessAnalysisUrl', () => {
  it.each<[string[], 'white' | 'black', string]>([
    [['e4', 'e5', 'Nf3'], 'white', '1.%20e4%20e5%202.%20Nf3'],
    [['e4'], 'black', '1.%20e4?color=black'],
    [[], 'white', ''],
  ])('%j as %s', (sans, color, tail) => {
    expect(lichessAnalysisUrl(sans, color)).toBe(`https://lichess.org/analysis/pgn/${tail}`);
  });
});

describe('LichessAnalysisBoard', () => {
  const deps = (clipboard: () => Promise<void> = async () => {}) => ({
    open: vi.fn<(url: string) => void>(),
    writeClipboard: vi.fn(clipboard),
    writePgn: vi.fn((m: Repertoire) => `PGN of ${m.name}`),
  });
  /** A line of `n` moves that goes back and forth, so its URL is as long as we like. */
  const shuffle = (n: number) => Array.from({ length: n }, (_, i) => ['Nf3', 'Nf6', 'Ng1', 'Ng8'][i % 4] as string);
  const board = (sans: string[], name = 'long') => {
    const { map, ids } = lineOf(sans);
    const rep = Repertoire.fromData({ ...map, name });
    return { rep, end: rep.endOf(ids.at(-1) as string), root: rep.rootCursor() };
  };

  it('opens the line to the cursor directly when the URL is short', async () => {
    const d = deps();
    const { rep, end } = board(['e4']);
    expect(await new LichessAnalysisBoard(d).open(rep, end)).toBe('opened');
    expect(d.open).toHaveBeenCalledExactlyOnceWith('https://lichess.org/analysis/pgn/1.%20e4');
    expect(d.writeClipboard).not.toHaveBeenCalled();
  });

  it('opens the start position for the root cursor, and respects the orientation', async () => {
    const d = deps();
    const { rep, root } = board(['e4']);
    await new LichessAnalysisBoard(d).open(rep, root);
    expect(d.open).toHaveBeenLastCalledWith('https://lichess.org/analysis/pgn/');
    await new LichessAnalysisBoard(d).open(flip(rep), root);
    expect(d.open).toHaveBeenLastCalledWith('https://lichess.org/analysis/pgn/?color=black');
  });

  it('copies the whole map as PGN and opens the study page when the URL is too long', async () => {
    const d = deps();
    const sans = shuffle(400);
    expect(lichessAnalysisUrl(sans, 'white').length).toBeGreaterThan(MAX_URL);
    const { rep, end } = board(sans);
    expect(await new LichessAnalysisBoard(d).open(rep, end)).toBe('copied');
    expect(d.writePgn).toHaveBeenCalledWith(rep);
    expect(d.writeClipboard).toHaveBeenCalledExactlyOnceWith('PGN of long');
    expect(d.open).toHaveBeenCalledExactlyOnceWith(LICHESS_STUDY_URL);
  });

  it('the URL threshold is inclusive: MAX_URL characters still go to the URL', async () => {
    // Each extra "Nf3 Nf6 Ng1 Ng8" cycle adds a fixed number of characters: find the longest line that still fits.
    let n = 1;
    while (lichessAnalysisUrl(shuffle(n + 1), 'white').length <= MAX_URL) n++;
    const fits = board(shuffle(n));
    const tooLong = board(shuffle(n + 1));
    const d = deps();
    expect(await new LichessAnalysisBoard(d).open(fits.rep, fits.end)).toBe('opened');
    expect(await new LichessAnalysisBoard(d).open(tooLong.rep, tooLong.end)).toBe('copied');
  });

  it('rejects, and does not open anything, when the clipboard fails', async () => {
    const d = deps(async () => { throw new DOMException('denied', 'NotAllowedError'); });
    const { rep, end } = board(shuffle(400));
    await expect(new LichessAnalysisBoard(d).open(rep, end)).rejects.toThrow('denied');
    expect(d.open).not.toHaveBeenCalled();
  });
});

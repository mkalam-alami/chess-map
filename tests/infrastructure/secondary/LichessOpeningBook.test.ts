import { beforeAll, describe, expect, it, vi } from 'vitest';
import { openingAt, openingText } from '../../../src/domain';
import { LichessOpeningBook, type OpeningTable } from '../../../src/infrastructure/secondary/openings/LichessOpeningBook';
import { pinnedOf } from '../../domain/fixtures';

const EPD_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';

describe('LichessOpeningBook with a small table', () => {
  const table: OpeningTable = { [EPD_E4]: ['B00', "King's Pawn"] };

  it('finds nothing before it is loaded', () => {
    expect(new LichessOpeningBook(async () => table).lookup(EPD_E4)).toBeUndefined();
  });

  it('finds positions after load, and nothing for unknown ones', async () => {
    const book = new LichessOpeningBook(async () => table);
    await book.load();
    expect(book.lookup(EPD_E4)).toEqual({ eco: 'B00', name: "King's Pawn" });
    expect(book.lookup('8/8/8/8/8/8/8/8 w - -')).toBeUndefined();
  });

  it('loads once, however often it is asked', async () => {
    const loader = vi.fn(async () => table);
    const book = new LichessOpeningBook(loader);
    await Promise.all([book.load(), book.load()]);
    await book.load();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('can retry after a failed load', async () => {
    const loader = vi.fn<() => Promise<OpeningTable>>().mockRejectedValueOnce(new Error('chunk failed')).mockResolvedValue(table);
    const book = new LichessOpeningBook(loader);
    await expect(book.load()).rejects.toThrow('chunk failed');
    expect(book.lookup(EPD_E4)).toBeUndefined();
    await book.load();
    expect(book.lookup(EPD_E4)?.name).toBe("King's Pawn");
  });
});

describe('LichessOpeningBook with the real data', () => {
  const book = new LichessOpeningBook();
  /** Opening at the end of a single pinned line. */
  const at = (sans: string[]) => {
    const { session, id } = pinnedOf(sans);
    return openingAt(session.repertoire.fenPath(session.repertoire.endOf(id)), (epd) => book.lookup(epd));
  };

  it('is null before the data is loaded', () => {
    expect(at(['e4'])).toBeNull();
  });

  describe('loaded', () => {
    beforeAll(() => book.load());

    it('names the Ruy Lopez exactly', () => {
      expect(at(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])).toMatchObject({ eco: 'C60', name: 'Ruy Lopez', exact: true, pliesSince: 0 });
    });

    it('reports plies since the last named position when out of book', () => {
      const o = at(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'h3', 'h6', 'a3']);
      expect(o?.name).toContain('Ruy Lopez');
      expect(o?.exact).toBe(false);
      expect(o?.pliesSince).toBeGreaterThan(0);
      expect(openingText(o!)).toBe(`${o?.name} +${o?.pliesSince}`);
    });

    it('names transpositions reached by another move order', () => {
      const a = at(['d4', 'd5', 'c4']);
      expect(a?.exact).toBe(true);
      expect(at(['c4', 'd5', 'd4'])).toEqual(a);
    });

    it('returns null at the start position', () => {
      const { session } = pinnedOf(['e4']);
      const rep = session.repertoire;
      expect(openingAt(rep.fenPath(rep.rootCursor()), (epd) => book.lookup(epd))).toBeNull();
    });
  });
});

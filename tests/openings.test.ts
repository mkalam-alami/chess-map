import { beforeAll, describe, expect, it } from 'vitest';
import { loadOpenings, openingAt, openingText } from '../src/chess/openings';
import { cursorEnd, rootCursor } from '../src/model/cursor';
import { pinnedOf } from './fixtures';

/** Opening at the end of a single pinned line. */
const at = (sans: string[]) => {
  const { map, id } = pinnedOf(sans);
  return openingAt(map, cursorEnd(map, id));
};

describe('openingAt', () => {
  it('is null before the data is loaded', () => {
    expect(at(['e4'])).toBeNull();
  });

  describe('loaded', () => {
    beforeAll(loadOpenings);

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
      const { map } = pinnedOf(['e4']);
      expect(openingAt(map, rootCursor(map))).toBeNull();
    });
  });
});

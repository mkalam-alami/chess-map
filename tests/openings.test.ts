import { beforeAll, describe, expect, it } from 'vitest';
import { loadOpenings, openingAt } from '../src/chess/openings';
import { cursorEnd } from '../src/model/cursor';
import type { ChessMap } from '../src/model/types';

function lineMap(sans: string[]): ChessMap {
  return {
    id: 'm', name: 'm', orientation: 'white', rootId: 'r',
    nodes: {
      r: { id: 'r', parentId: null, plies: [], pinned: false, lngLat: [0, 0], children: ['a'] },
      a: { id: 'a', parentId: 'r', plies: sans, pinned: true, lngLat: [0, 0], children: [] },
    },
  };
}
const at = (sans: string[]) => {
  const m = lineMap(sans);
  return openingAt(m, cursorEnd(m, 'a'));
};

describe('openingAt', () => {
  it('is null before the data is loaded', () => {
    expect(at(['e4'])).toBeNull();
  });

  describe('loaded', () => {
    beforeAll(loadOpenings);

    it('names the Ruy Lopez exactly', () => {
      const o = at(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
      expect(o).toMatchObject({ eco: 'C60', name: 'Ruy Lopez', exact: true, pliesSince: 0 });
    });

    it('reports plies since the last named position when out of book', () => {
      const o = at(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'h3', 'h6', 'a3']);
      expect(o?.name).toContain('Ruy Lopez');
      expect(o?.exact).toBe(false);
      expect(o?.pliesSince).toBeGreaterThan(0);
    });

    it('names transpositions reached by another move order', () => {
      const a = at(['d4', 'd5', 'c4']);
      const b = at(['c4', 'd5', 'd4']);
      expect(a?.exact).toBe(true);
      expect(b).toEqual(a);
    });

    it('returns null at the start position', () => {
      const m = lineMap(['e4']);
      expect(openingAt(m, { nodeId: 'r', ply: 0 })).toBeNull();
    });
  });
});

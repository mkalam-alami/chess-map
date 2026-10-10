import { describe, expect, it } from 'vitest';
import { START_FEN, epd, openingAt, openingText, tryMove, type OpeningLookup } from '../../src/domain';

/** FENs of a line from the start position. */
function fensOf(sans: string[]): string[] {
  const out = [START_FEN];
  for (const san of sans) out.push(tryMove(out.at(-1) as string, san)?.fen as string);
  return out;
}

/** A tiny book: 1.e4 is "King's Pawn", 1.e4 e5 is "Open Game", 1.d4 d5 2.c4 is "Queen's Gambit". */
function book(): OpeningLookup {
  const named = new Map([
    [epd(fensOf(['e4']).at(-1) as string), { eco: 'B00', name: "King's Pawn" }],
    [epd(fensOf(['e4', 'e5']).at(-1) as string), { eco: 'C20', name: 'Open Game' }],
    [epd(fensOf(['d4', 'd5', 'c4']).at(-1) as string), { eco: 'D06', name: "Queen's Gambit" }],
  ]);
  return (e) => named.get(e);
}

describe('openingAt', () => {
  it('names the current position exactly', () => {
    expect(openingAt(fensOf(['e4', 'e5']), book())).toEqual({ eco: 'C20', name: 'Open Game', exact: true, movesSince: 0 });
  });

  it('falls back to the deepest named position and counts the moves since', () => {
    expect(openingAt(fensOf(['e4', 'e5', 'Nf3', 'Nc6']), book())).toEqual({ eco: 'C20', name: 'Open Game', exact: false, movesSince: 2 });
    expect(openingAt(fensOf(['e4', 'c5']), book())).toEqual({ eco: 'B00', name: "King's Pawn", exact: false, movesSince: 1 });
  });

  it('is null when nothing on the way is named (including the start position)', () => {
    expect(openingAt(fensOf([]), book())).toBeNull();
    expect(openingAt(fensOf(['Nf3', 'Nf6']), book())).toBeNull();
    expect(openingAt([], book())).toBeNull();
  });

  it('looks positions up by EPD, so transpositions and move counters do not matter', () => {
    const a = openingAt(fensOf(['d4', 'd5', 'c4']), book());
    expect(a?.name).toBe("Queen's Gambit");
    expect(openingAt(fensOf(['c4', 'd5', 'd4']), book())).toEqual(a);
  });

  it('only asks the lookup with FEN fields 1-4', () => {
    const asked: string[] = [];
    openingAt(fensOf(['e4']), (e) => (asked.push(e), undefined));
    expect(asked.every((e) => e.split(' ').length === 4)).toBe(true);
    expect(asked).toHaveLength(2);
  });

  it('stops at the deepest hit without asking about shallower positions', () => {
    const asked: string[] = [];
    const lookup: OpeningLookup = (e) => (asked.push(e), { eco: 'X', name: 'Anything' });
    openingAt(fensOf(['e4', 'e5']), lookup);
    expect(asked).toHaveLength(1);
  });
});

describe('openingText', () => {
  it('is the bare name when exact and has a +n suffix out of book', () => {
    expect(openingText({ eco: 'C20', name: 'Open Game', exact: true, movesSince: 0 })).toBe('Open Game');
    expect(openingText({ eco: 'C20', name: 'Open Game', exact: false, movesSince: 3 })).toBe('Open Game +3');
  });
});

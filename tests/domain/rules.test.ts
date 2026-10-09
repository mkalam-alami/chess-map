import { describe, expect, it } from 'vitest';
import { START_FEN, epd, formatLine, inCheck, legalDests, moveLabel, moveSquares, promotionColor, tryMove, turnColor } from '../../src/domain';

describe('position helpers', () => {
  it('epd drops the move counters', () => {
    expect(epd(START_FEN)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });

  it('turnColor reads the side to move', () => {
    expect(turnColor(START_FEN)).toBe('white');
    expect(turnColor(tryMove(START_FEN, 'e4')?.fen as string)).toBe('black');
  });
});

describe('tryMove', () => {
  it('plays SAN and from/to moves and returns the canonical SAN and the new FEN', () => {
    expect(tryMove(START_FEN, 'e4')?.san).toBe('e4');
    expect(tryMove(START_FEN, { from: 'g1', to: 'f3' })?.san).toBe('Nf3');
    expect(tryMove(START_FEN, 'e4')?.fen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
  });

  it('rejects illegal moves', () => {
    expect(tryMove(START_FEN, 'e5')).toBeNull();
    expect(tryMove(START_FEN, { from: 'e2', to: 'e5' })).toBeNull();
    expect(tryMove(START_FEN, 'nonsense')).toBeNull();
  });

  it('promotes with the requested piece', () => {
    const promo = '8/4P3/8/8/8/8/k7/4K3 w - - 0 1';
    expect(tryMove(promo, { from: 'e7', to: 'e8', promotion: 'n' })?.san).toBe('e8=N');
  });
});

describe('legalDests', () => {
  it('lists destinations by origin square (chessground format)', () => {
    const d = legalDests(START_FEN);
    expect(d.get('e2')).toEqual(expect.arrayContaining(['e3', 'e4']));
    expect(d.get('g1')?.sort()).toEqual(['f3', 'h3']);
    expect(d.has('e1')).toBe(false);
  });

  it('is empty when the game is over', () => {
    expect(legalDests('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').size).toBe(0);
  });
});

describe('promotion, check and move squares', () => {
  const promo = '8/4P3/8/8/8/8/k7/4K3 w - - 0 1';

  it('detects the colour of a promoting pawn only', () => {
    expect(promotionColor(promo, 'e7', 'e8')).toBe('white');
    expect(promotionColor('4k3/8/8/8/8/8/4p3/K7 b - - 0 1', 'e2', 'e1')).toBe('black');
    expect(promotionColor(START_FEN, 'e2', 'e4')).toBeNull();
    expect(promotionColor(START_FEN, 'g1', 'f3')).toBeNull();
  });

  it('detects check', () => {
    expect(inCheck(START_FEN)).toBe(false);
    expect(inCheck('4k3/8/8/8/8/8/8/4K2r w - - 0 1')).toBe(true);
  });

  it('gives the from / to squares of a SAN move, undefined when illegal', () => {
    expect(moveSquares(START_FEN, 'Nf3')).toEqual(['g1', 'f3']);
    expect(moveSquares(START_FEN, 'Nf6')).toBeUndefined();
  });
});

describe('move text', () => {
  it('formatLine numbers White moves and marks a Black start', () => {
    expect(formatLine(['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
    expect(formatLine(['e5', 'Nf3'], 1)).toBe('1… e5 2. Nf3');
    expect(formatLine([])).toBe('');
  });

  it('moveLabel uses a dot for White and an ellipsis for Black', () => {
    expect(moveLabel(0, 'e4')).toBe('1.e4');
    expect(moveLabel(1, 'e5')).toBe('1…e5');
    expect(moveLabel(4, 'Nf3')).toBe('3.Nf3');
  });
});

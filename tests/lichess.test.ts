import { describe, expect, it } from 'vitest';
import { lichessAnalysisUrl, lichessTarget, MAX_URL } from '../src/lichess/url';
import { rootCursor } from '../src/model/cursor';
import { addChild, createMap } from '../src/model/tree';

describe('lichessAnalysisUrl', () => {
  it('encodes the PGN as a path segment', () => {
    expect(lichessAnalysisUrl(['e4', 'e5', 'Nf3'], 'white')).toBe('https://lichess.org/analysis/pgn/1.%20e4%20e5%202.%20Nf3');
  });
  it('adds color=black for black orientation', () => {
    expect(lichessAnalysisUrl(['e4'], 'black')).toBe('https://lichess.org/analysis/pgn/1.%20e4?color=black');
  });
  it('handles the empty line', () => {
    expect(lichessAnalysisUrl([], 'white')).toBe('https://lichess.org/analysis/pgn/');
  });
});

describe('lichessTarget', () => {
  it('returns a url for short lines', () => {
    const m = createMap('t', 'white', [0, 0]);
    const r = addChild(m, m.rootId, 'e4', [1, 1]);
    const t = lichessTarget(r.map, { nodeId: r.nodeId, ply: 1 });
    expect(t).toEqual({ kind: 'url', url: 'https://lichess.org/analysis/pgn/1.%20e4' });
    expect(lichessTarget(m, rootCursor(m)).kind).toBe('url');
  });

  it('falls back to the clipboard when the url is too long', () => {
    const shuffle = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
    let m = createMap('long', 'white', [0, 0]);
    let id = m.rootId;
    for (let i = 0; i < 400; i++) {
      const r = addChild(m, id, shuffle[i % 4] as string, [i * 0.1, 0]);
      m = r.map;
      id = r.nodeId;
    }
    const t = lichessTarget(m, { nodeId: id, ply: 1 });
    expect(lichessAnalysisUrl(Array(400).fill('Nf3'), 'white').length).toBeGreaterThan(MAX_URL);
    expect(t.kind).toBe('clipboard');
    if (t.kind === 'clipboard') {
      expect(t.url).toBe('https://lichess.org/study');
      expect(t.pgn).toContain('[Event "long"]');
      expect(t.pgn).toContain('[%geo');
    }
  });
});

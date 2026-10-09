import { describe, expect, it } from 'vitest';
import { lichessAnalysisUrl, lichessTarget, LICHESS_STUDY_URL, MAX_URL } from '../src/lichess/url';
import { Repertoire } from '../src/domain';
import { lineOf } from './domain/fixtures';

describe('lichessAnalysisUrl', () => {
  it.each<[string[], 'white' | 'black', string]>([
    [['e4', 'e5', 'Nf3'], 'white', '1.%20e4%20e5%202.%20Nf3'],
    [['e4'], 'black', '1.%20e4?color=black'],
    [[], 'white', ''],
  ])('%j as %s', (sans, color, tail) => {
    expect(lichessAnalysisUrl(sans, color)).toBe(`https://lichess.org/analysis/pgn/${tail}`);
  });
});

describe('lichessTarget', () => {
  it('returns a url for short lines', () => {
    const { map, ids } = lineOf(['e4']);
    expect(lichessTarget(map, Repertoire.fromData(map).endOf(ids[1] as string))).toEqual({ kind: 'url', url: 'https://lichess.org/analysis/pgn/1.%20e4' });
    expect(lichessTarget(map, Repertoire.fromData(map).rootCursor()).kind).toBe('url');
  });

  it('falls back to the clipboard when the url is too long', () => {
    const shuffle = Array.from({ length: 400 }, (_, i) => ['Nf3', 'Nf6', 'Ng1', 'Ng8'][i % 4] as string);
    const { map, ids } = lineOf(shuffle);
    expect(lichessAnalysisUrl(shuffle, 'white').length).toBeGreaterThan(MAX_URL);
    const t = lichessTarget({ ...map, name: 'long' }, Repertoire.fromData(map).endOf(ids.at(-1) as string));
    expect(t).toMatchObject({ kind: 'clipboard', url: LICHESS_STUDY_URL });
    expect(t.kind === 'clipboard' && t.pgn).toContain('[Event "long"]');
    expect(t.kind === 'clipboard' && t.pgn).toContain('[%geo');
  });
});

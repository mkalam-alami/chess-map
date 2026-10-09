import { describe, expect, it } from 'vitest';
import * as domain from '../../src/domain';

describe('public API of the domain', () => {
  it('exports models and pure helpers, and no tree surgery', () => {
    expect(Object.keys(domain).sort()).toEqual([
      'DEFAULT_BOARD_ZOOM', 'DEFAULT_CENTER', 'LIBRARY_VERSION', 'Library', 'NOMINAL_PX', 'Repertoire', 'START_FEN', 'Session',
      'epd', 'formatLine', 'inCheck', 'legalDests', 'moveLabel', 'moveSquares', 'newId', 'openingAt', 'openingText',
      'promotionColor', 'sameCursor', 'sameLngLat', 'tryMove', 'turnColor', 'wrapLng', 'wrapNear',
    ]);
  });

  it('newId gives distinct ids', () => {
    expect(domain.newId()).not.toBe(domain.newId());
    expect(typeof domain.newId()).toBe('string');
  });

  it('models have private constructors: they are built with named factories', () => {
    expect(typeof domain.Repertoire.create).toBe('function');
    expect(typeof domain.Repertoire.fromData).toBe('function');
    expect(typeof domain.Library.of).toBe('function');
    expect(typeof domain.Library.fromData).toBe('function');
    expect(typeof domain.Session.start).toBe('function');
  });
});

import { describe, expect, it } from 'vitest';
import * as domain from '../../src/domain';

describe('public API of the domain', () => {
  it('exports models and pure helpers, and no tree surgery', () => {
    expect(Object.keys(domain).sort()).toEqual([
      'DEFAULT_BOARD_ZOOM', 'DEFAULT_CENTER', 'LIBRARY_VERSION', 'Library', 'NOMINAL_PX', 'Repertoire', 'SHAPE_BRUSHES', 'START_FEN', 'Session',
      'epd', 'formatLine', 'inCheck', 'legalDests', 'moveLabel', 'moveSquares', 'newId', 'openingAt', 'openingText',
      'promotionColor', 'sameCursor', 'sameLngLat', 'tryMove', 'turnColor', 'wrapLng', 'wrapNear',
    ]);
  });

  it('newId gives distinct ids', () => {
    expect(domain.newId()).not.toBe(domain.newId());
    expect(typeof domain.newId()).toBe('string');
  });

  it('Library exposes read-only queries and factories, no plumbing', () => {
    expect(Object.getOwnPropertyNames(domain.Library).filter((k) => !['length', 'name', 'prototype'].includes(k)).sort()).toEqual(['fromData', 'initial']);
    expect(Object.getOwnPropertyNames(domain.Library.prototype).sort()).toEqual(
      ['active', 'constructor', 'data', 'get', 'has', 'ids', 'repertoires', 'size'],
    );
  });

  it('Repertoire exposes read-only queries and factories, no commands', () => {
    expect(Object.getOwnPropertyNames(domain.Repertoire).filter((k) => !['length', 'name', 'prototype'].includes(k)).sort()).toEqual(['create', 'fromData']);
    expect(Object.getOwnPropertyNames(domain.Repertoire.prototype).sort()).toEqual([
      'back', 'boardZoom', 'branchIds', 'branchSize', 'canTakeBack', 'constructor', 'data', 'distancesFrom', 'effectiveBoardZoom', 'endOf',
      'fenAt', 'fenPath', 'firstMoveIndex', 'hasNode', 'id', 'lineCursors', 'name', 'next', 'node', 'nodes', 'orientation',
      'pathTo', 'pinLabel', 'rootCursor', 'rootId', 'sanPath', 'shapesAt', 'sizeSum', 'transpositions', 'view',
    ]);
  });

  it('Session is the only model with user actions', () => {
    expect(typeof domain.Session.start).toBe('function'); // (private statics are only hidden by the compiler)
    expect(typeof domain.Session.empty).toBe('function');
    for (const action of [
      'goTo', 'back', 'forward', 'switchMode', 'toggleMode', 'toggleRecording', 'play', 'movePlacing', 'confirmPlacing', 'cancelPlacing', 'takeBack',
      'relocate', 'nameLocation', 'annotate', 'drawShapes', 'showNote', 'resizeBoard', 'deletePosition', 'startRelocating', 'previewRelocation', 'endRelocating',
      'createMap', 'switchMap', 'addMaps', 'renameMap', 'flipOrientation', 'duplicateMap', 'deleteMap', 'rememberView',
    ]) {
      expect(typeof (domain.Session.prototype as unknown as Record<string, unknown>)[action], action).toBe('function');
    }
  });

  it('models have private constructors: they are built with named factories', () => {
    expect(typeof domain.Repertoire.create).toBe('function');
    expect(typeof domain.Repertoire.fromData).toBe('function');
    expect(typeof domain.Library.initial).toBe('function');
    expect(typeof domain.Library.fromData).toBe('function');
    expect(typeof domain.Session.start).toBe('function');
  });
});

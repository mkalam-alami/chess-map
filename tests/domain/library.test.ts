import { describe, expect, it } from 'vitest';
import { LIBRARY_VERSION, Library, Repertoire, type LibraryData } from '../../src/domain';
import { emptyRep, lineOf } from './fixtures';

const three = (): { lib: Library; a: Repertoire; b: Repertoire; c: Repertoire } => {
  const a = emptyRep('A');
  const b = emptyRep('B');
  const c = emptyRep('C');
  return { lib: Library.of(a).add(b).add(c).activate(a.id), a, b, c };
};

describe('creating', () => {
  it('of() holds one active map', () => {
    const a = emptyRep('A');
    const lib = Library.of(a);
    expect(lib.size).toBe(1);
    expect(lib.activeId).toBe(a.id);
    expect(lib.active).toBe(a);
    expect(lib.ids()).toEqual([a.id]);
  });

  it('initial() is one empty white repertoire named "My repertoire"', () => {
    const lib = Library.initial();
    expect(lib.size).toBe(1);
    expect(lib.active).toMatchObject({ name: 'My repertoire', orientation: 'white' });
    expect(lib.active.nodes()).toHaveLength(1);
  });
});

describe('data', () => {
  it('has the persisted shape: version, maps by id, active id', () => {
    const { lib, a, b, c } = three();
    expect(lib.data).toEqual({ version: LIBRARY_VERSION, maps: { [a.id]: a.data, [b.id]: b.data, [c.id]: c.data }, activeMapId: a.id });
  });

  it('is the same object on every call, and contains the very same map data', () => {
    const { lib, a } = three();
    expect(lib.data).toBe(lib.data);
    expect(lib.data.maps[a.id]).toBe(a.data);
  });

  it('fromData / data round-trip', () => {
    const { lib } = three();
    expect(Library.fromData(lib.data).data).toEqual(lib.data);
    expect(Library.fromData(lib.data).ids()).toEqual(lib.ids());
  });

  it('fromData refuses an unknown active map', () => {
    const { lib } = three();
    expect(() => Library.fromData({ ...lib.data, activeMapId: 'ghost' } as LibraryData)).toThrow(/active map/);
  });

  it('fromData refuses a map without a root', () => {
    const { lib, a } = three();
    const broken = { ...lib.data, maps: { ...lib.data.maps, [a.id]: { ...a.data, nodes: {} } } };
    expect(() => Library.fromData(broken)).toThrow(/no root/);
  });
});

describe('reading', () => {
  it('get / has / repertoires', () => {
    const { lib, a, b } = three();
    expect(lib.get(b.id)).toBe(b);
    expect(lib.has(a.id)).toBe(true);
    expect(lib.has('ghost')).toBe(false);
    expect(lib.repertoires().map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(() => lib.get('ghost')).toThrow(/Unknown map/);
  });
});

describe('add', () => {
  it('appends the map and makes it active, leaving the original untouched', () => {
    const a = emptyRep('A');
    const b = emptyRep('B');
    const lib = Library.of(a);
    const next = lib.add(b);
    expect(next.ids()).toEqual([a.id, b.id]);
    expect(next.activeId).toBe(b.id);
    expect(lib.size).toBe(1);
    expect(lib.activeId).toBe(a.id);
  });

  it('replaces a map with the same id in place (keeping its position)', () => {
    const { lib, a, b } = three();
    const renamed = b.rename('B2');
    const next = lib.add(renamed);
    expect(next.ids()).toEqual([a.id, b.id, lib.ids()[2]]);
    expect(next.get(b.id).name).toBe('B2');
    expect(next.activeId).toBe(b.id);
  });
});

describe('activate', () => {
  it('switches the active map', () => {
    const { lib, b } = three();
    expect(lib.activate(b.id).activeId).toBe(b.id);
    expect(lib.activeId).not.toBe(b.id);
  });

  it('returns the same library for an unknown id', () => {
    const { lib } = three();
    expect(lib.activate('ghost')).toBe(lib);
  });
});

describe('update', () => {
  it('replaces a map by id without changing the active one', () => {
    const { lib, b } = three();
    const next = lib.update(b.rename('Renamed'));
    expect(next.get(b.id).name).toBe('Renamed');
    expect(next.activeId).toBe(lib.activeId);
    expect(next.ids()).toEqual(lib.ids());
  });

  it('throws on a map that is not in the library', () => {
    const { lib } = three();
    expect(() => lib.update(emptyRep('X'))).toThrow(/Unknown map/);
  });

  it('keeps map data identity for the untouched maps', () => {
    const { lib, a, b } = three();
    const next = lib.update(b.rename('Renamed'));
    expect(next.data.maps[a.id]).toBe(a.data);
  });
});

describe('remove', () => {
  it('removes a non-active map and keeps the active one', () => {
    const { lib, a, b } = three();
    const next = lib.remove(b.id);
    expect(next.has(b.id)).toBe(false);
    expect(next.activeId).toBe(a.id);
    expect(next.size).toBe(2);
  });

  it('activates the first remaining map when the active one goes', () => {
    const { lib, a, b } = three();
    const next = lib.remove(a.id);
    expect(next.activeId).toBe(b.id);
  });

  it('never removes the last map', () => {
    const a = emptyRep('A');
    const lib = Library.of(a);
    expect(lib.remove(a.id)).toBe(lib);
  });

  it('ignores unknown ids', () => {
    const { lib } = three();
    expect(lib.remove('ghost')).toBe(lib);
  });
});

describe('immutability', () => {
  it('commands never change the library they were called on', () => {
    const { lib, b } = three();
    const before = JSON.stringify(lib.data);
    lib.add(emptyRep('D'));
    lib.activate(b.id);
    lib.update(b.rename('Z'));
    lib.remove(b.id);
    expect(JSON.stringify(lib.data)).toBe(before);
  });

  it('keeps the repertoires\' trees', () => {
    const { map } = lineOf(['e4']);
    const lib = Library.of(Repertoire.fromData(map));
    expect(lib.active.nodes()).toHaveLength(2);
  });
});

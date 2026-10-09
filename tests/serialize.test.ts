import { describe, expect, it } from 'vitest';
import { deserializeLibrary, exportMap, importMap, serializeLibrary, ValidationError } from '../src/model/serialize';
import { branchAt, createLibrary, setNote, setPlace, setSizeDelta } from '../src/model/tree';
import type { Library } from '../src/model/types';
import { flushSave, loadLibrary, saveLibrary, STORAGE_KEY } from '../src/store/persist';
import { pinnedOf } from './fixtures';

/** A pinned segment split by a branch, with a note, a place, a size and a saved view. */
function sample(): Library {
  const { map: m0, id } = pinnedOf(['e4', 'e5', 'Nf3', 'Nc6']);
  let map = branchAt(m0, { nodeId: id, ply: 2 }, 'f4', [4, 50]).map;
  map = setNote(map, id, 'King pawn');
  map = setPlace(map, id, { label: 'Paris', country: 'France' });
  map = setSizeDelta(map, id, 0.75);
  return createLibrary({ ...map, name: 'Test', view: { center: [1, 2], zoom: 3 }, boardZoom: 2 });
}

/** The sample as plain JSON, its active map and one way to reach its nodes. */
function raw() {
  const lib = sample();
  const json = JSON.parse(serializeLibrary(lib));
  const map = json.maps[lib.activeMapId];
  const nodes = Object.values(map.nodes) as Record<string, any>[];
  return { lib, json, map, nonRoot: nodes.find((n) => n.parentId !== null) as Record<string, any> };
}

describe('serialize', () => {
  it('round-trips from JSON text and parsed JSON', () => {
    const lib = sample();
    expect(deserializeLibrary(JSON.parse(serializeLibrary(lib)))).toEqual(lib);
    expect(deserializeLibrary(serializeLibrary(lib))).toEqual(lib);
  });

  it('exports/imports a map with a fresh id', () => {
    const lib = sample();
    const map = lib.maps[lib.activeMapId]!;
    const back = importMap(exportMap(map));
    expect(back.id).not.toBe(map.id);
    expect({ ...back, id: map.id }).toEqual(map);
    expect(() => importMap(serializeLibrary(lib))).toThrow(ValidationError);
  });

  it('rejects illegal moves with a path', () => {
    const { json, map } = raw();
    const seg = Object.values(map.nodes).find((n: any) => n.plies.includes('e5')) as any;
    seg.plies[1] = 'Qh5';
    expect(() => deserializeLibrary(json)).toThrow(expect.objectContaining({ path: `maps.${map.id}.nodes.${seg.id}.plies[1]` }));
  });

  it.each([null, 'nope', {}, { version: 99 }, { version: 1, maps: [], activeMapId: 'x' }])('rejects %j', (bad) => {
    expect(() => deserializeLibrary(bad)).toThrow(ValidationError);
  });

  it.each<[string, (r: ReturnType<typeof raw>) => void, RegExp]>([
    ['an unknown active map', (r) => void (r.json.activeMapId = 'missing'), /activeMapId/],
    ['an orphan node', (r) => void (r.map.nodes.zzz = { id: 'zzz', parentId: null, plies: ['e4'], pinned: false, lngLat: [0, 0], children: [] }), /parent/],
    ['a bad position', (r) => void (r.map.nodes[r.map.rootId].lngLat = [0, 'x']), /lngLat/],
    ['a node that is its own parent', (r) => void (r.nonRoot.parentId = r.nonRoot.id), /parent/],
    ['a non-numeric size', (r) => void (r.nonRoot.sizeDelta = 'big'), /sizeDelta/],
  ])('rejects %s', (_, corrupt, message) => {
    const r = raw();
    corrupt(r);
    expect(() => deserializeLibrary(r.json)).toThrow(message);
  });
});

describe('persist', () => {
  const fakeStorage = () => {
    const data = new Map<string, string>();
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('saves (debounced) and loads', () => {
    const s = fakeStorage();
    const lib = sample();
    saveLibrary(lib, s, 10_000);
    expect(s.data.has(STORAGE_KEY)).toBe(false);
    flushSave();
    expect(loadLibrary(s)).toEqual(lib);
  });

  it('returns null for missing/corrupt data and keeps the corrupt copy', () => {
    const s = fakeStorage();
    expect(loadLibrary(s)).toBeNull();
    s.data.set(STORAGE_KEY, '{oops');
    expect(loadLibrary(s)).toBeNull();
    expect(s.data.get(`${STORAGE_KEY}:corrupt`)).toBe('{oops');
  });
});

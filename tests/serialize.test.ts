import { describe, expect, it } from 'vitest';
import { deserializeLibrary, exportMap, importMap, serializeLibrary, ValidationError } from '../src/model/serialize';
import { addChild, appendPly, branchAt, createLibrary, createMap, setNote, setPinned, setPlace } from '../src/model/tree';
import { flushSave, loadLibrary, saveLibrary, STORAGE_KEY } from '../src/store/persist';

function sample() {
  let map = createMap('Test', 'black', [2.35, 48.85]);
  const a = addChild(map, map.rootId, 'e4', [3, 49]);
  map = setPinned(a.map, a.nodeId, true);
  for (const s of ['e5', 'Nf3', 'Nc6']) map = appendPly(map, a.nodeId, s);
  map = branchAt(map, { nodeId: a.nodeId, ply: 2 }, 'f4', [4, 50]).map;
  map = setNote(map, a.nodeId, 'King pawn');
  map = setPlace(map, a.nodeId, { label: 'Paris', country: 'France' });
  return createLibrary({ ...map, view: { center: [1, 2], zoom: 3 } });
}

describe('serialize', () => {
  it('round-trips', () => {
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
    const lib = sample();
    const map = lib.maps[lib.activeMapId]!;
    const raw = JSON.parse(serializeLibrary(lib));
    const first = Object.values(raw.maps[map.id].nodes).find((n: any) => n.plies.includes('Nf3')) as any;
    first.plies[1] = 'Qh5';
    try {
      deserializeLibrary(raw);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).path).toBe(`maps.${map.id}.nodes.${first.id}.plies[1]`);
    }
  });
  it('rejects malformed data', () => {
    const lib = sample();
    const clone = () => JSON.parse(serializeLibrary(lib));
    const bad: unknown[] = [null, 'nope', {}, { version: 99 }, { version: 1, maps: [], activeMapId: 'x' }];
    for (const b of bad) expect(() => deserializeLibrary(b)).toThrow(ValidationError);
    const noActive = clone();
    noActive.activeMapId = 'missing';
    expect(() => deserializeLibrary(noActive)).toThrow(/activeMapId/);
    const orphan = clone();
    const m = orphan.maps[lib.activeMapId];
    m.nodes.zzz = { id: 'zzz', parentId: null, plies: ['e4'], pinned: false, lngLat: [0, 0], children: [] };
    expect(() => deserializeLibrary(orphan)).toThrow(ValidationError);
    const badPos = clone();
    badPos.maps[lib.activeMapId].nodes[badPos.maps[lib.activeMapId].rootId].lngLat = [0, 'x'];
    expect(() => deserializeLibrary(badPos)).toThrow(/lngLat/);
    const badParent = clone();
    const nodes = badParent.maps[lib.activeMapId].nodes;
    const child = Object.values(nodes).find((n: any) => n.parentId !== null) as any;
    child.parentId = child.id;
    expect(() => deserializeLibrary(badParent)).toThrow(ValidationError);
  });
});

describe('persist', () => {
  const fake = () => {
    const data = new Map<string, string>();
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  it('saves (debounced) and loads', () => {
    const s = fake();
    const lib = sample();
    saveLibrary(lib, s, 10_000);
    expect(s.data.has(STORAGE_KEY)).toBe(false);
    flushSave();
    expect(loadLibrary(s)).toEqual(lib);
  });
  it('returns null for missing/corrupt data', () => {
    const s = fake();
    expect(loadLibrary(s)).toBeNull();
    s.data.set(STORAGE_KEY, '{oops');
    expect(loadLibrary(s)).toBeNull();
    expect(s.data.get(`${STORAGE_KEY}:corrupt`)).toBe('{oops');
  });
});

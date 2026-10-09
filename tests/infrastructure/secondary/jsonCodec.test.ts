import { describe, expect, it } from 'vitest';
import { ImportError } from '../../../src/application';
import { LIBRARY_VERSION, Library, Repertoire } from '../../../src/domain';
import {
  deserializeLibrary, deserializeMap, migrate, serializeLibrary, serializeMap, ValidationError,
} from '../../../src/infrastructure/secondary/storage/jsonCodec';
import { libraryOf, pinnedOf } from '../../domain/fixtures';

/** A pinned segment split by a branch, with a note, a place, a size and a saved view. */
function sample(): Library {
  const { session, id } = pinnedOf(['e4', 'e5', 'Nf3', 'Nc6']);
  let s = session.goTo({ nodeId: id, ply: 2 }).play('f4', [[4, 50]]).confirmPlacing();
  s = s.annotate(id, 'King pawn').nameLocation(id, { label: 'Paris', country: 'France' }).resizeBoard(id, 0.75);
  const map = { ...s.repertoire.data, name: 'Test', view: { center: [1, 2] as [number, number], zoom: 3 }, boardZoom: 2 };
  return libraryOf(Repertoire.fromData(map));
}

/** The sample as plain JSON, its active map and one way to reach its nodes. */
function raw() {
  const lib = sample();
  const json = JSON.parse(serializeLibrary(lib));
  const map = json.maps[lib.activeId];
  const nodes = Object.values(map.nodes) as Record<string, any>[];
  return { lib, json, map, nonRoot: nodes.find((n) => n.parentId !== null) as Record<string, any> };
}

describe('library codec', () => {
  it('round-trips from JSON text and parsed JSON', () => {
    const lib = sample();
    expect(deserializeLibrary(JSON.parse(serializeLibrary(lib))).data).toEqual(lib.data);
    expect(deserializeLibrary(serializeLibrary(lib)).data).toEqual(lib.data);
  });

  it('returns a domain Library on its active map', () => {
    const lib = deserializeLibrary(serializeLibrary(sample()));
    expect(lib).toBeInstanceOf(Library);
    expect(lib.active.name).toBe('Test');
  });

  it('rejects illegal moves with a path', () => {
    const { json, map } = raw();
    const seg = Object.values(map.nodes).find((n: any) => n.plies.includes('e5')) as any;
    seg.plies[1] = 'Qh5';
    expect(() => deserializeLibrary(json)).toThrow(expect.objectContaining({ path: `maps.${map.id}.nodes.${seg.id}.plies[1]` }));
  });

  it.each([null, 'nope', '{oops', {}, { version: 99 }, { version: 'one' }, { version: 1, maps: [], activeMapId: 'x' }])('rejects %j', (bad) => {
    expect(() => deserializeLibrary(bad)).toThrow(ValidationError);
  });

  it.each<[string, (r: ReturnType<typeof raw>) => void, RegExp]>([
    ['an unknown active map', (r) => void (r.json.activeMapId = 'missing'), /activeMapId/],
    ['an orphan node', (r) => void (r.map.nodes.zzz = { id: 'zzz', parentId: null, plies: ['e4'], pinned: false, lngLat: [0, 0], children: [] }), /parent/],
    ['a bad position', (r) => void (r.map.nodes[r.map.rootId].lngLat = [0, 'x']), /lngLat/],
    ['a node that is its own parent', (r) => void (r.nonRoot.parentId = r.nonRoot.id), /parent/],
    ['a non-numeric size', (r) => void (r.nonRoot.sizeDelta = 'big'), /sizeDelta/],
    ['a map stored under another id', (r) => void (r.map.id = 'other'), /maps\..*\.id/],
    ['an invalid orientation', (r) => void (r.map.orientation = 'green'), /orientation/],
    ['a node whose key differs from its id', (r) => void (r.nonRoot.id = 'else'), /must equal its key/],
    ['a lastChild that is not a child', (r) => void (r.map.nodes[r.map.rootId].lastChild = 'nowhere'), /lastChild/],
    ['a segment without plies', (r) => void (r.nonRoot.plies = []), /at least one ply/],
  ])('rejects %s', (_, corrupt, message) => {
    const r = raw();
    corrupt(r);
    expect(() => deserializeLibrary(r.json)).toThrow(message);
  });
});

describe('migrations', () => {
  const steps = { 1: (r: Record<string, unknown>) => ({ ...r, version: 2, upgraded: true }), 2: (r: Record<string, unknown>) => ({ ...r, version: 3 }) };

  it('runs every step from the stored version up to the current one', () => {
    expect(migrate({ version: 1 }, steps, 3)).toEqual({ version: 3, upgraded: true });
    expect(migrate({ version: 2 }, steps, 3)).toEqual({ version: 3 });
    expect(migrate({ version: 3, x: 1 }, steps, 3)).toEqual({ version: 3, x: 1 });
  });

  it('refuses newer versions, missing versions and gaps in the chain', () => {
    expect(() => migrate({ version: 4 }, steps, 3)).toThrow(/unsupported version 4/);
    expect(() => migrate({}, steps, 3)).toThrow(/missing version/);
    expect(() => migrate({ version: 1 }, { 2: steps[2] }, 3)).toThrow(/no migration from version 1/);
  });

  it('the current version needs no migration', () => {
    const json = { version: LIBRARY_VERSION, maps: {} };
    expect(migrate(json)).toBe(json);
  });
});

describe('map file codec', () => {
  it('exports and imports a map under a fresh id', () => {
    const rep = sample().active;
    const back = deserializeMap(serializeMap(rep));
    expect(back.id).not.toBe(rep.id);
    expect({ ...back.data, id: rep.id }).toEqual(rep.data);
  });

  it('writes a self-describing file', () => {
    expect(JSON.parse(serializeMap(sample().active))).toMatchObject({ format: 'chess-map', version: LIBRARY_VERSION });
  });

  it.each<[string, string, RegExp]>([
    ['text that is not JSON', '{oops', /not valid JSON/],
    ['a whole library file', serializeLibrary(sample()), /not a Chess Map file/],
    ['a file from a newer version', JSON.stringify({ format: 'chess-map', version: 99, map: {} }), /cannot be read: unsupported version 99/],
    ['a file without a version', JSON.stringify({ format: 'chess-map', map: {} }), /cannot be read: missing version/],
    ['a map that is not an object', JSON.stringify({ format: 'chess-map', version: LIBRARY_VERSION, map: 3 }), /invalid \(map: expected an object\)/],
  ])('rejects %s with a readable ImportError', (_, text, message) => {
    expect(() => deserializeMap(text)).toThrow(ImportError);
    expect(() => deserializeMap(text)).toThrow(message);
  });

  it('names the offending field of a broken map', () => {
    const file = JSON.parse(serializeMap(sample().active));
    const node = Object.values(file.map.nodes).find((n: any) => n.parentId !== null) as any;
    node.plies[0] = 'Qh5';
    expect(() => deserializeMap(JSON.stringify(file))).toThrow(/illegal move "Qh5"/);
  });
});

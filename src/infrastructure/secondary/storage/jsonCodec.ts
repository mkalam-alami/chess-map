import {
  LIBRARY_VERSION, Library, SHAPE_BRUSHES, Repertoire, START_FEN, newId, tryMove,
  type BoardShape, type ChessMapData, type LngLat, type MapNodeData, type NodeId,
} from '../../../domain';
import { ImportError } from '../../../application';

/** Stored or imported JSON that does not have the expected shape; `path` points at the offending field. */
export class ValidationError extends Error {
  constructor(public path: string, public reason: string) {
    super(`Invalid data at ${path}: ${reason}`);
    this.name = 'ValidationError';
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Renames a field on every node of a library (`maps`) or single-map (`map`) JSON and bumps its version by one. */
function renameNodeField(raw: Json, from: string, to: string): Json {
  const renameIn = (m: unknown): unknown => {
    if (!isObj(m) || !isObj(m.nodes)) return m;
    const nodes = Object.fromEntries(Object.entries(m.nodes).map(([id, n]) => {
      if (!isObj(n) || !(from in n)) return [id, n];
      const { [from]: value, ...rest } = n;
      return [id, { ...rest, [to]: value }];
    }));
    return { ...m, nodes };
  };
  const out: Json = { ...raw, version: (raw.version as number) + 1 };
  if (isObj(raw.maps)) out.maps = Object.fromEntries(Object.entries(raw.maps).map(([k, m]) => [k, renameIn(m)]));
  if ('map' in raw) out.map = renameIn(raw.map);
  return out;
}

/** Steps from version N to N + 1, keyed by N. */
export const MIGRATIONS: Record<number, (raw: Json) => Json> = {
  // 1 -> 2: `MapNodeData.plies` became `moves` (the word "ply" left the vocabulary, see the glossary in docs/ARCHITECTURE.md).
  1: (raw) => renameNodeField(raw, 'plies', 'moves'),
};

/** Upgrades older library JSON to the current version; throws on unknown/newer versions. */
export function migrate(raw: unknown, migrations: Record<number, (raw: Json) => Json> = MIGRATIONS, current = LIBRARY_VERSION): Json {
  if (!isObj(raw)) throw new ValidationError('$', 'expected an object');
  let cur: Json = raw;
  if (typeof cur.version !== 'number') throw new ValidationError('version', 'missing version');
  let v: number = cur.version;
  if (v > current) throw new ValidationError('version', `unsupported version ${v}`);
  while (v < current) {
    const step = migrations[v];
    if (!step) throw new ValidationError('version', `no migration from version ${v}`);
    cur = step(cur);
    v = cur.version as number;
  }
  return cur;
}

const parse = (input: unknown): unknown => {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    throw new ValidationError('$', 'not valid JSON');
  }
};

const str = (v: unknown, path: string): string => {
  if (typeof v !== 'string') throw new ValidationError(path, 'expected a string');
  return v;
};

const num = (v: unknown, path: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ValidationError(path, 'expected a finite number');
  return v;
};

const lngLat = (v: unknown, path: string): LngLat => {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new ValidationError(path, 'expected [lng, lat]');
  }
  return [v[0] as number, v[1] as number];
};

const SQUARE = /^[a-h][1-8]$/;

function validateShapes(v: unknown, path: string, moves: number): Record<number, BoardShape[]> {
  if (!isObj(v)) throw new ValidationError(path, 'expected an object');
  const out: Record<number, BoardShape[]> = {};
  for (const [key, list] of Object.entries(v)) {
    const played = Number(key);
    const p = `${path}.${key}`;
    if (!Number.isInteger(played) || played < 0 || played > moves) throw new ValidationError(p, 'expected a move count of the segment');
    if (!Array.isArray(list)) throw new ValidationError(p, 'expected an array');
    out[played] = list.map((s, i): BoardShape => {
      const sp = `${p}[${i}]`;
      if (!isObj(s)) throw new ValidationError(sp, 'expected an object');
      const orig = str(s.orig, `${sp}.orig`);
      const brush = SHAPE_BRUSHES.find((b) => b === s.brush);
      if (!SQUARE.test(orig)) throw new ValidationError(`${sp}.orig`, 'expected a square');
      if (!brush) throw new ValidationError(`${sp}.brush`, `expected ${SHAPE_BRUSHES.join('|')}`);
      if (s.dest === undefined) return { orig, brush };
      const dest = str(s.dest, `${sp}.dest`);
      if (!SQUARE.test(dest)) throw new ValidationError(`${sp}.dest`, 'expected a square');
      return { orig, dest, brush };
    });
  }
  return out;
}

function validateMap(raw: unknown, path: string): ChessMapData {
  if (!isObj(raw)) throw new ValidationError(path, 'expected an object');
  const id = str(raw.id, `${path}.id`);
  const name = str(raw.name, `${path}.name`);
  if (raw.orientation !== 'white' && raw.orientation !== 'black') throw new ValidationError(`${path}.orientation`, 'expected white|black');
  const rootId = str(raw.rootId, `${path}.rootId`);
  if (!isObj(raw.nodes)) throw new ValidationError(`${path}.nodes`, 'expected an object');
  const rawNodes = raw.nodes;
  const nodes: Record<NodeId, MapNodeData> = {};

  for (const [key, rn] of Object.entries(rawNodes)) {
    const p = `${path}.nodes.${key}`;
    if (!isObj(rn)) throw new ValidationError(p, 'expected an object');
    if (rn.id !== key) throw new ValidationError(`${p}.id`, 'must equal its key');
    const parentId = rn.parentId === null ? null : str(rn.parentId, `${p}.parentId`);
    if (!Array.isArray(rn.moves) || !rn.moves.every((s) => typeof s === 'string')) throw new ValidationError(`${p}.moves`, 'expected string[]');
    if (typeof rn.pinned !== 'boolean') throw new ValidationError(`${p}.pinned`, 'expected boolean');
    if (!Array.isArray(rn.children) || !rn.children.every((s) => typeof s === 'string')) throw new ValidationError(`${p}.children`, 'expected string[]');
    const node: MapNodeData = {
      id: key, parentId, moves: rn.moves as string[], pinned: rn.pinned,
      lngLat: lngLat(rn.lngLat, `${p}.lngLat`), children: rn.children as string[],
    };
    if (rn.note !== undefined) node.note = str(rn.note, `${p}.note`);
    if (rn.noteShown !== undefined) {
      if (typeof rn.noteShown !== 'boolean') throw new ValidationError(`${p}.noteShown`, 'expected boolean');
      if (rn.noteShown) node.noteShown = true;
    }
    if (rn.shapes !== undefined) {
      const shapes = validateShapes(rn.shapes, `${p}.shapes`, node.moves.length);
      if (Object.values(shapes).some((l) => l.length)) node.shapes = Object.fromEntries(Object.entries(shapes).filter(([, l]) => l.length));
    }
    if (rn.sizeDelta !== undefined) node.sizeDelta = num(rn.sizeDelta, `${p}.sizeDelta`);
    if (rn.lastChild !== undefined) {
      node.lastChild = str(rn.lastChild, `${p}.lastChild`);
      if (!node.children.includes(node.lastChild)) throw new ValidationError(`${p}.lastChild`, 'not among children');
    }
    if (rn.place !== undefined) {
      if (!isObj(rn.place)) throw new ValidationError(`${p}.place`, 'expected an object');
      node.place = { label: str(rn.place.label, `${p}.place.label`) };
      if (rn.place.country !== undefined) node.place.country = str(rn.place.country, `${p}.place.country`);
    }
    nodes[key] = node;
  }

  const root = nodes[rootId];
  if (!root) throw new ValidationError(`${path}.rootId`, 'root node missing');
  if (root.parentId !== null) throw new ValidationError(`${path}.nodes.${rootId}.parentId`, 'root must have no parent');
  for (const node of Object.values(nodes)) {
    const p = `${path}.nodes.${node.id}`;
    if (node.id !== rootId && node.parentId === null) throw new ValidationError(`${p}.parentId`, 'only the root may have no parent');
    if (node.id !== rootId && node.moves.length === 0) throw new ValidationError(`${p}.moves`, 'non-root node needs at least one move');
    if (new Set(node.children).size !== node.children.length) throw new ValidationError(`${p}.children`, 'duplicate child');
    node.children.forEach((c, i) => {
      if (nodes[c]?.parentId !== node.id) throw new ValidationError(`${p}.children[${i}]`, `${c} is missing or has a different parent`);
    });
  }

  // Reachability (rejects cycles/orphans) + replay legality
  const seen = new Set<NodeId>();
  const walk = (node: MapNodeData, startFen: string): void => {
    seen.add(node.id);
    let fen = startFen;
    node.moves.forEach((san, i) => {
      const r = tryMove(fen, san);
      if (!r) throw new ValidationError(`${path}.nodes.${node.id}.moves[${i}]`, `illegal move "${san}"`);
      fen = r.fen;
    });
    for (const c of node.children) {
      if (seen.has(c)) throw new ValidationError(`${path}.nodes.${node.id}.children`, 'cycle');
      walk(nodes[c] as MapNodeData, fen);
    }
  };
  walk(root, START_FEN);
  const orphan = Object.keys(nodes).find((k) => !seen.has(k));
  if (orphan) throw new ValidationError(`${path}.nodes.${orphan}`, 'unreachable from root');

  const map: ChessMapData = { id, name, orientation: raw.orientation, rootId, nodes };
  if (raw.boardZoom !== undefined) map.boardZoom = num(raw.boardZoom, `${path}.boardZoom`);
  if (raw.view !== undefined) {
    if (!isObj(raw.view) || typeof raw.view.zoom !== 'number') throw new ValidationError(`${path}.view`, 'expected {center, zoom}');
    map.view = { center: lngLat(raw.view.center, `${path}.view.center`), zoom: raw.view.zoom };
  }
  return map;
}

export const serializeLibrary = (library: Library): string => JSON.stringify(library.data);

/** Accepts parsed JSON or a JSON string. Migrates, validates structure and replays every line. Throws ValidationError. */
export function deserializeLibrary(json: unknown): Library {
  const raw = migrate(parse(json));
  if (!isObj(raw.maps)) throw new ValidationError('maps', 'expected an object');
  const maps: Record<string, ChessMapData> = {};
  for (const [key, m] of Object.entries(raw.maps)) {
    const map = validateMap(m, `maps.${key}`);
    if (map.id !== key) throw new ValidationError(`maps.${key}.id`, 'must equal its key');
    maps[key] = map;
  }
  const activeMapId = str(raw.activeMapId, 'activeMapId');
  if (!maps[activeMapId]) throw new ValidationError('activeMapId', 'unknown map');
  return Library.fromData({ version: LIBRARY_VERSION, maps, activeMapId });
}

const MAP_FORMAT = 'chess-map';

export const serializeMap = (map: Repertoire): string => JSON.stringify({ format: MAP_FORMAT, version: LIBRARY_VERSION, map: map.data }, null, 2);

/** Validates a single-map export and returns it under a fresh map id. Throws ImportError with a readable message. */
export function deserializeMap(json: unknown): Repertoire {
  try {
    const raw = migrate(parse(json));
    if (raw.format !== MAP_FORMAT) throw new ValidationError('format', `expected "${MAP_FORMAT}"`);
    return Repertoire.fromData({ ...validateMap(raw.map, 'map'), id: newId() });
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    throw new ImportError(readable(e));
  }
}

function readable(e: ValidationError): string {
  if (e.path === '$' && e.reason === 'not valid JSON') return 'This file is not valid JSON';
  if (e.path === 'format') return 'This is not a Chess Map file';
  if (e.path === 'version') return `This map file cannot be read: ${e.reason}`;
  return `This map file is invalid (${e.path}: ${e.reason})`;
}

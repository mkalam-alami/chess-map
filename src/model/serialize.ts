import { LIBRARY_VERSION, START_FEN, newId, tryMove, type ChessMapData, type LibraryData, type LngLat, type MapNodeData, type NodeId } from '../domain';

export class ValidationError extends Error {
  constructor(public path: string, reason: string) {
    super(`Invalid data at ${path}: ${reason}`);
    this.name = 'ValidationError';
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

const MIGRATIONS: Record<number, (raw: Json) => Json> = {
  // 1: (raw) => ({ ...raw, version: 2 }),  // add one entry per schema bump
};

/** Upgrades older library JSON to the current version; throws on unknown/newer versions. */
export function migrate(raw: unknown): Json {
  if (!isObj(raw)) throw new ValidationError('$', 'expected an object');
  let cur: Json = raw;
  if (typeof cur.version !== 'number') throw new ValidationError('version', 'missing version');
  let v: number = cur.version;
  if (v > LIBRARY_VERSION) throw new ValidationError('version', `unsupported version ${v}`);
  while (v < LIBRARY_VERSION) {
    const step = MIGRATIONS[v];
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
    if (!Array.isArray(rn.plies) || !rn.plies.every((s) => typeof s === 'string')) throw new ValidationError(`${p}.plies`, 'expected string[]');
    if (typeof rn.pinned !== 'boolean') throw new ValidationError(`${p}.pinned`, 'expected boolean');
    if (!Array.isArray(rn.children) || !rn.children.every((s) => typeof s === 'string')) throw new ValidationError(`${p}.children`, 'expected string[]');
    const node: MapNodeData = {
      id: key, parentId, plies: rn.plies as string[], pinned: rn.pinned,
      lngLat: lngLat(rn.lngLat, `${p}.lngLat`), children: rn.children as string[],
    };
    if (rn.note !== undefined) node.note = str(rn.note, `${p}.note`);
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
    if (node.id !== rootId && node.plies.length === 0) throw new ValidationError(`${p}.plies`, 'non-root node needs at least one ply');
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
    node.plies.forEach((san, i) => {
      const r = tryMove(fen, san);
      if (!r) throw new ValidationError(`${path}.nodes.${node.id}.plies[${i}]`, `illegal move "${san}"`);
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

export const serializeLibrary = (lib: LibraryData): string => JSON.stringify(lib);

/** Accepts parsed JSON or a JSON string. Migrates, validates structure and replays every line. */
export function deserializeLibrary(json: unknown): LibraryData {
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
  return { version: LIBRARY_VERSION, maps, activeMapId };
}

const MAP_FORMAT = 'chess-map';

export const exportMap = (map: ChessMapData): string => JSON.stringify({ format: MAP_FORMAT, version: LIBRARY_VERSION, map }, null, 2);

/** Validates a single-map export and returns it under a fresh map id. */
export function importMap(json: unknown): ChessMapData {
  const raw = migrate(parse(json));
  if (raw.format !== MAP_FORMAT) throw new ValidationError('format', `expected "${MAP_FORMAT}"`);
  return { ...validateMap(raw.map, 'map'), id: newId() };
}

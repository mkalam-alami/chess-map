import { parseGames, type ParseTree } from '@mliebelt/pgn-parser';
import { DEFAULT_CENTER, START_FEN, newId, tryMove, turnColor, wrapLng, type ChessMapData, type LngLat, type MapNodeData, type NodeId } from '../../../../domain';
import { ImportError } from '../../../../application';
import { unescapeArg } from './export';

/** Auto-placement step in degrees of latitude (~400 km). */
export const FAN_STEP = 3.5;

type PgnMoveLike = {
  notation: { notation: string };
  variations?: PgnMoveLike[][];
  commentDiag?: Record<string, unknown> | null;
  commentAfter?: string | null;
};

interface Meta {
  geo?: LngLat;
  pinned?: boolean;
  size?: number;
  noteShown?: boolean;
  /** `[%pinned 0|1]` was present: following geo-less moves belong to this node. */
  merge: boolean;
  place?: string;
  country?: string;
  note?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function parseGeo(v: unknown): LngLat | undefined {
  const s = str(v);
  if (!s) return undefined;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 360 ? [lng, lat] : undefined;
}

const unquote = (s: string): string => unescapeArg(s.replace(/^"([\s\S]*)"$/, '$1'));

function metaOf(diag: Record<string, unknown> | null | undefined): Meta {
  const d = diag ?? {};
  const meta: Meta = { merge: false };
  const geo = parseGeo(d.geo);
  if (geo) meta.geo = geo;
  const pinned = str(d.pinned);
  if (pinned !== undefined) {
    meta.merge = true;
    meta.pinned = pinned.trim() !== '0';
  }
  const size = Number(str(d.size));
  if (str(d.size) && Number.isFinite(size) && size !== 0) meta.size = size;
  if (str(d.noteshown)?.trim() === '1') meta.noteShown = true;
  const place = str(d.place);
  if (place) meta.place = unquote(place);
  const country = str(d.country);
  if (country) meta.country = unquote(country);
  const note = str(d.comment)?.trim();
  if (note) meta.note = note;
  return meta;
}

interface Draft {
  node: MapNodeData;
  hasGeo: boolean;
}

function fail(game: number, san: string, fen: string): never {
  const dots = turnColor(fen) === 'white' ? '.' : '...';
  throw new ImportError(`Game ${game}: illegal move "${san}" at move ${fen.split(' ')[5]}${dots}`);
}

function placeOf(meta: Meta): MapNodeData['place'] | undefined {
  if (!meta.place) return undefined;
  return meta.country ? { label: meta.place, country: meta.country } : { label: meta.place };
}

function importGame(tree: ParseTree, index: number, opts: { name?: string; origin?: LngLat }, total: number): ChessMapData {
  const tags = (tree.tags ?? {}) as Record<string, unknown>;
  if (typeof tags.FEN === 'string' || tags.SetUp === '1') {
    throw new ImportError(`Game ${index + 1}: custom start positions (FEN header) are not supported yet`);
  }
  const event = str(tags.Event);
  const name =
    event && event !== '?' ? event : opts.name ? (total > 1 ? `${opts.name} (${index + 1})` : opts.name) : `Imported game ${index + 1}`;
  const orientation = str(tags.Orientation)?.toLowerCase() === 'black' ? 'black' : 'white';

  const rootMeta = metaOf(tree.gameComment as Record<string, unknown> | undefined);
  const root: MapNodeData = {
    id: newId(), parentId: null, moves: [], pinned: rootMeta.pinned === true,
    lngLat: rootMeta.geo ?? opts.origin ?? DEFAULT_CENTER, children: [],
  };
  const rootPlace = placeOf(rootMeta);
  if (rootPlace) root.place = rootPlace;
  if (rootMeta.note) root.note = rootMeta.note;
  if (rootMeta.size) root.sizeDelta = rootMeta.size;
  if (rootMeta.noteShown && root.note) root.noteShown = true;
  const drafts = new Map<NodeId, Draft>([[root.id, { node: root, hasGeo: true }]]);

  const play = (m: PgnMoveLike, fen: string): { san: string; fen: string } =>
    tryMove(fen, m.notation.notation) ?? fail(index + 1, m.notation.notation, fen);

  const metaOfMove = (m: PgnMoveLike): Meta => {
    const meta = metaOf(m.commentDiag);
    if (!m.commentDiag && m.commentAfter?.trim()) meta.note = m.commentAfter.trim();
    return meta;
  };

  /** `line[i]` and its variations are siblings at the position `parentFen`. */
  const build = (parentId: NodeId, parentFen: string, line: PgnMoveLike[], i: number): void => {
    const first = line[i] as PgnMoveLike;
    const lines: [PgnMoveLike[], number][] = [[line, i], ...(first.variations ?? []).map((v): [PgnMoveLike[], number] => [v, 0])];
    for (const [ln, start] of lines) {
      const head = ln[start];
      if (!head) continue;
      let r = play(head, parentFen);
      const meta = metaOfMove(head);
      const node: MapNodeData = {
        id: newId(), parentId, moves: [r.san], pinned: meta.pinned === true, lngLat: meta.geo ?? [0, 0], children: [],
      };
      const p = placeOf(meta);
      if (p) node.place = p;
      if (meta.size) node.sizeDelta = meta.size;
      const notes: string[] = meta.note ? [meta.note] : [];
      drafts.set(node.id, { node, hasGeo: meta.geo !== undefined });
      const parent = (drafts.get(parentId) as Draft).node;
      parent.children.push(node.id);
      parent.lastChild ??= node.id;

      let j = start + 1;
      // Merge geo-less, branch-free follow-up moves into a segment head.
      while (meta.merge) {
        const next = ln[j];
        if (!next || (next.variations?.length ?? 0) > 0) break;
        const nm = metaOfMove(next);
        if (nm.geo || nm.merge) break;
        r = play(next, r.fen);
        node.moves.push(r.san);
        if (nm.note) notes.push(nm.note);
        j++;
      }
      if (notes.length) node.note = notes.join(' ');
      if (meta.noteShown && node.note) node.noteShown = true;
      if (ln[j]) build(node.id, r.fen, ln, j);
    }
  };

  const moves = tree.moves as unknown as PgnMoveLike[];
  if (moves.length) build(root.id, START_FEN, moves, 0);

  // Auto-placement of nodes without %geo: parents before children.
  const place = (id: NodeId, gpPos: LngLat | null): void => {
    const n = (drafts.get(id) as Draft).node;
    const pos = n.lngLat;
    const base = gpPos ? Math.atan2(pos[1] - gpPos[1], pos[0] - gpPos[0]) : Math.PI / 2;
    const taken: LngLat[] = n.children.filter((c) => (drafts.get(c) as Draft).hasGeo).map((c) => (drafts.get(c) as Draft).node.lngLat);
    n.children.forEach((cid, k) => {
      const cd = drafts.get(cid) as Draft;
      if (cd.hasGeo) return;
      cd.node.lngLat = fan(pos, base, k, taken);
      taken.push(cd.node.lngLat);
      cd.hasGeo = true;
    });
    for (const cid of n.children) place(cid, pos);
  };
  place(root.id, null);

  const nodes: Record<NodeId, MapNodeData> = {};
  for (const [id, d] of drafts) nodes[id] = d.node;
  const bz = Number(str(tags.BoardZoom));
  return { id: newId(), name, orientation, rootId: root.id, nodes, ...(str(tags.BoardZoom) && Number.isFinite(bz) ? { boardZoom: bz } : {}) };
}

/** Deterministic spread: sibling k goes to angle base + 0, +s, -s, +2s, -2s... around the outward direction. */
export function fan(parent: LngLat, baseAngle: number, k: number, taken: LngLat[] = []): LngLat {
  const spread = (45 * Math.PI) / 180;
  const slot = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2);
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = baseAngle + slot * spread + attempt * 0.29;
    let lat = parent[1] + FAN_STEP * Math.sin(angle);
    lat = Math.max(-80, Math.min(80, lat));
    const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
    const lng = Number(wrapLng([parent[0] + (FAN_STEP * Math.cos(angle)) / cos, lat])[0].toFixed(5));
    lat = Number(lat.toFixed(5));
    if (!taken.some((t) => Math.abs(t[0] - lng) < 0.01 && Math.abs(t[1] - lat) < 0.01)) return [lng, lat];
  }
  return [parent[0] + 0.5 * (k + 1), parent[1]];
}

/** Parses a (multi-game) PGN into one map per game. Throws ImportError with a readable message. */
export function importPgn(text: string, opts: { name?: string; origin?: LngLat } = {}): ChessMapData[] {
  const src = text.replace(/^﻿/, '').replace(/\[%pinned\s*\]/g, '[%pinned 1]');
  if (!src.trim()) throw new ImportError('No PGN data found');
  let games: ParseTree[];
  try {
    games = parseGames(src);
  } catch (e) {
    const hint = (e as { errorHint?: string }).errorHint;
    throw new ImportError(`Could not parse PGN: ${hint ?? (e as Error).message}`);
  }
  if (!games.length) throw new ImportError('No games found in PGN');
  return games.map((g, i) => importGame(g, i, opts, games.length));
}

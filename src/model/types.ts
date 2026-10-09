export type MapId = string;
export type NodeId = string;
export type LngLat = [lng: number, lat: number];

export interface SavedView { center: LngLat; zoom: number }

export interface MapNode {
  id: NodeId;
  parentId: NodeId | null;
  /** SAN plies. Root: []; normal marker: 1 ply; pinned segment: n plies. */
  plies: string[];
  /** Pinned: new moves are appended to `plies` instead of spawning children. */
  pinned: boolean;
  lngLat: LngLat;
  place?: { label: string; country?: string };
  note?: string;
  /** Ordered. Children always hang off the END of this node's segment. */
  children: NodeId[];
  /** What "forward" follows when there are several children. */
  lastChild?: NodeId;
  /** log2 board size relative to the parent's board (default 0 = same size; positive = bigger). */
  sizeDelta?: number;
}

export interface ChessMap {
  id: MapId;
  name: string;
  orientation: 'white' | 'black';
  rootId: NodeId;
  nodes: Record<NodeId, MapNode>;
  view?: SavedView;
  /** Map zoom at which the root board renders at NOMINAL_PX (default 1.5). */
  boardZoom?: number;
}

export interface Library {
  version: 1;
  maps: Record<MapId, ChessMap>;
  activeMapId: MapId;
}

/**
 * Cursor convention: `ply` is the NUMBER of plies of the node's segment that
 * have been played (0..plies.length). The position at a cursor is the one
 * after those plies. So:
 *  - root is {rootId, 0} (start position);
 *  - entering a 1-ply marker gives {id, 1};
 *  - back from {id, 1} goes to the parent at its end ({parent, parent.plies.length});
 *  - non-root cursors always have ply >= 1.
 */
export interface Cursor { nodeId: NodeId; ply: number }

export function getNode(map: ChessMap, id: NodeId): MapNode {
  const node = map.nodes[id];
  if (!node) throw new Error(`Unknown node ${id}`);
  return node;
}

import type { LngLat, Place } from '../geo';

export type { LngLat, Place };
export type MapId = string;
export type NodeId = string;
export type Orientation = 'white' | 'black';
/** `explore`: training, only repertoire moves are allowed. `edit`: building. */
export type Mode = 'explore' | 'edit';

/** Version of the persisted `LibraryData` shape. Bump it together with a migration (see the storage codec). */
export const LIBRARY_VERSION = 2;

export interface SavedView { center: LngLat; zoom: number }

/** Colours of the right-click annotations (chessground's four brushes). */
export const SHAPE_BRUSHES = ['green', 'red', 'blue', 'yellow'] as const;
export type ShapeBrush = (typeof SHAPE_BRUSHES)[number];

/** A circle (no `dest`) or an arrow drawn on the board; squares are `a1`..`h8`. */
export interface BoardShape { orig: string; dest?: string; brush: ShapeBrush }

/** Persisted shape of one position (JSON-compatible, unchanged across the refactor). */
export interface MapNodeData {
  id: NodeId;
  parentId: NodeId | null;
  /** SAN moves. Root: []; normal marker: 1 move; pinned segment: n moves. */
  moves: string[];
  /** Pinned: new moves are appended to `moves` instead of spawning children. */
  pinned: boolean;
  lngLat: LngLat;
  place?: Place;
  note?: string;
  /** The note stays visible under the marker while the board is closed (default false = absent). */
  noteShown?: boolean;
  /** Ordered. Children always hang off the END of this node's segment. */
  children: NodeId[];
  /** What "forward" follows when there are several children. */
  lastChild?: NodeId;
  /** Annotations drawn on the board, keyed by `played` (the position after that many moves of the segment). Absent = none. */
  shapes?: Record<number, BoardShape[]>;
  /** log2 board size relative to the parent's board (default 0 = same size; positive = bigger). */
  sizeDelta?: number;
}

/** Persisted shape of one chess map. */
export interface ChessMapData {
  id: MapId;
  name: string;
  orientation: Orientation;
  rootId: NodeId;
  nodes: Record<NodeId, MapNodeData>;
  view?: SavedView;
  /** Map zoom at which the root board renders at NOMINAL_PX (default 1.5). */
  boardZoom?: number;
}

/** Persisted shape of the whole library. */
export interface LibraryData {
  version: typeof LIBRARY_VERSION;
  maps: Record<MapId, ChessMapData>;
  activeMapId: MapId;
}

/**
 * Cursor convention: `played` is the NUMBER of moves of the node's segment that
 * have been played (0..moves.length). The position at a cursor is the one
 * after those moves. So:
 *  - root is {rootId, 0} (start position);
 *  - entering a 1-move marker gives {id, 1};
 *  - back from {id, 1} goes to the parent at its end ({parent, parent.moves.length});
 *  - non-root cursors always have played >= 1 (a node has at least one move).
 */
export interface Cursor { nodeId: NodeId; played: number }

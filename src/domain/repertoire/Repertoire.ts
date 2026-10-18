import { epd, moveLabel } from '../chess/rules';
import type { LngLat } from '../geo';
import { cursorBack, cursorEnd, lineCursors, nextCursor, rootCursor } from './cursor';
import { fenAt, fenPath } from './positions';
import { effectiveBoardZoom, rootBoardZoom, sizeSum } from './scale';
import {
  createMapData, getNode, minPlayed, nodeDistances, pathTo, sanPath, subtreeIds,
} from './tree';
import type { BoardShape, ChessMapData, Cursor, MapId, MapNodeData, NodeId, Orientation, SavedView } from './types';

/** A marker spells out its whole segment up to this many moves; longer ones show the first and last move around an ellipsis. */
const PIN_LABEL_MOVES = 3;

/**
 * One chess map: a tree of positions. Immutable and read-only: it only answers queries. Changes are made through
 * `Session` actions, which apply the package-private `commands` (they only enforce tree integrity; `Session` owns the
 * rules about WHEN they apply).
 */
export class Repertoire {
  private constructor(private readonly d: ChessMapData) {}

  /** A map with only the start position, placed at `at`. */
  static create(name: string, orientation: Orientation, at: LngLat): Repertoire {
    return new Repertoire(createMapData(name, orientation, at));
  }

  /** Wraps already validated data (secondary adapters validate before calling this). */
  static fromData(data: ChessMapData): Repertoire {
    if (!data.nodes[data.rootId]) throw new Error(`Map ${data.id} has no root node`);
    return new Repertoire(data);
  }

  /** The plain persisted shape (same object on every call). */
  get data(): ChessMapData {
    return this.d;
  }

  // ---- queries ----

  get id(): MapId { return this.d.id; }
  get name(): string { return this.d.name; }
  get orientation(): Orientation { return this.d.orientation; }
  get rootId(): NodeId { return this.d.rootId; }
  get view(): SavedView | undefined { return this.d.view; }
  /** Map zoom at which the root board renders at NOMINAL_PX. */
  get boardZoom(): number { return rootBoardZoom(this.d); }

  /** Throws on unknown ids: use `hasNode` to test. */
  node(id: NodeId): MapNodeData { return getNode(this.d, id); }
  hasNode(id: NodeId): boolean { return this.d.nodes[id] !== undefined; }
  nodes(): MapNodeData[] { return Object.values(this.d.nodes); }

  rootCursor(): Cursor { return rootCursor(this.d); }
  /** Cursor after the full segment of a node. */
  endOf(nodeId: NodeId): Cursor { return cursorEnd(this.d, nodeId); }
  /** Node ids from the root down to `nodeId`. */
  pathTo(nodeId: NodeId): NodeId[] { return pathTo(this.d, nodeId); }
  /** Number of nodes in the branch starting at `nodeId` (itself included). */
  branchSize(nodeId: NodeId): number { return subtreeIds(this.d, nodeId).length; }
  /** Ids of the branch starting at `nodeId` (itself included). */
  branchIds(nodeId: NodeId): NodeId[] { return subtreeIds(this.d, nodeId); }

  fenAt(cursor: Cursor): string { return fenAt(this.d, cursor); }
  /** FENs from the start position up to the cursor (one more than `sanPath`). */
  fenPath(cursor: Cursor): string[] { return fenPath(this.d, cursor); }
  /** All moves from the root up to the cursor. */
  sanPath(cursor: Cursor): string[] { return sanPath(this.d, cursor); }
  /** One cursor per move of the line leading to `cursor` (parallel to `sanPath`). */
  lineCursors(cursor: Cursor): Cursor[] { return lineCursors(this.d, cursor); }

  /** One move back; null at the start position. */
  back(cursor: Cursor): Cursor | null { return cursorBack(this.d, cursor); }
  /** The annotations drawn on the board at `cursor` (empty when none). */
  shapesAt(cursor: Cursor): BoardShape[] { return this.node(cursor.nodeId).shapes?.[cursor.played] ?? []; }
  /** Where playing `san` leads inside the existing tree; null if it is a new move. */
  next(cursor: Cursor, san: string): Cursor | null { return nextCursor(this.d, cursor, san); }

  /** Other cursors in the map reaching the same position (FEN fields 1-4). */
  transpositions(cursor: Cursor): Cursor[] {
    const target = epd(this.fenAt(cursor));
    const out: Cursor[] = [];
    for (const node of this.nodes()) {
      for (let played = minPlayed(node); played <= node.moves.length; played++) {
        if (node.id === cursor.nodeId && played === cursor.played) continue;
        if (epd(this.fenAt({ nodeId: node.id, played })) === target) out.push({ nodeId: node.id, played });
      }
    }
    return out;
  }

  /** Markers between `nodeId` and every node of the tree, walking up and down (parent and children are 1 away). */
  distancesFrom(nodeId: NodeId): Map<NodeId, number> { return nodeDistances(this.d, nodeId); }

  /** Sum of the log2 board size deltas from the root down to the node. */
  sizeSum(nodeId: NodeId): number { return sizeSum(this.d, nodeId); }
  /** Map zoom at which the node's board renders at NOMINAL_PX. */
  effectiveBoardZoom(nodeId: NodeId): number { return effectiveBoardZoom(this.d, nodeId); }

  /** Game move index of the node's first move (0 = White's first move). */
  firstMoveIndex(nodeId: NodeId): number {
    const node = this.node(nodeId);
    if (node.parentId === null) return 0;
    const parent = this.node(node.parentId);
    return sanPath(this.d, { nodeId: parent.id, played: parent.moves.length }).length;
  }

  /** `3.Nf3 … (+4)` for multi-move segments; the start marker is a board icon. */
  pinLabel(nodeId: NodeId): string {
    const node = this.node(nodeId);
    if (node.parentId === null) return '♟';
    const start = this.firstMoveIndex(nodeId);
    const numbered = (i: number): string => moveLabel(start + i, node.moves[i] as string);
    // Consecutive moves read as PGN: only the first and White's moves carry a number.
    const run = (i: number): string => (i > 0 && (start + i) % 2 === 1 ? (node.moves[i] as string) : numbered(i));
    if (node.moves.length > PIN_LABEL_MOVES) return `${numbered(0)} … ${numbered(node.moves.length - 1)}`;
    return node.moves.map((_, i) => run(i)).join(' ');
  }
}

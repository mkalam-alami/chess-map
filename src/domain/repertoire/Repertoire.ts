import { epd, moveLabel } from '../chess/rules';
import type { LngLat } from '../geo';
import { cursorBack, cursorEnd, cursorForward, lineCursors, nextCursor, rootCursor } from './cursor';
import { fenAt, fenPath } from './positions';
import { effectiveBoardZoom, rootBoardZoom, sizeSum } from './scale';
import {
  canUndoLastPly, createMapData, getNode, minPly, nodeDistances, pathTo, sanPath, subtreeIds,
} from './tree';
import type { ChessMapData, Cursor, MapId, MapNodeData, NodeId, Orientation, SavedView } from './types';

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
  /** All plies from the root up to the cursor. */
  sanPath(cursor: Cursor): string[] { return sanPath(this.d, cursor); }
  /** One cursor per ply of the line leading to `cursor` (parallel to `sanPath`). */
  lineCursors(cursor: Cursor): Cursor[] { return lineCursors(this.d, cursor); }

  /** One ply back; null at the start position. */
  back(cursor: Cursor): Cursor | null { return cursorBack(this.d, cursor); }
  /** One ply forward: within the segment, else the last visited child or the only child; null otherwise. */
  forward(cursor: Cursor): Cursor | null { return cursorForward(this.d, cursor); }
  /** Where playing `san` leads inside the existing tree; null if it is a new move. */
  next(cursor: Cursor, san: string): Cursor | null { return nextCursor(this.d, cursor, san); }

  /** Other cursors in the map reaching the same position (FEN fields 1-4). */
  transpositions(cursor: Cursor): Cursor[] {
    const target = epd(this.fenAt(cursor));
    const out: Cursor[] = [];
    for (const node of this.nodes()) {
      for (let ply = minPly(node); ply <= node.plies.length; ply++) {
        if (node.id === cursor.nodeId && ply === cursor.ply) continue;
        if (epd(this.fenAt({ nodeId: node.id, ply })) === target) out.push({ nodeId: node.id, ply });
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

  /** Game ply index of the node's first ply (0 = White's first move). */
  firstPlyIndex(nodeId: NodeId): number {
    const node = this.node(nodeId);
    if (node.parentId === null) return 0;
    const parent = this.node(node.parentId);
    return sanPath(this.d, { nodeId: parent.id, ply: parent.plies.length }).length;
  }

  /** `3.Nf3 … (+4)` for multi-ply segments; the start marker is a board icon. */
  pinLabel(nodeId: NodeId): string {
    const node = this.node(nodeId);
    if (node.parentId === null) return '♟';
    const first = moveLabel(this.firstPlyIndex(nodeId), node.plies[0] as string);
    return node.plies.length > 1 ? `${first} … (+${node.plies.length - 1})` : first;
  }

  /** Take-back rules: only at the end of a leaf segment that keeps at least 1 ply (the root keeps 0). */
  canTakeBack(cursor: Cursor): boolean {
    return cursor.ply === this.node(cursor.nodeId).plies.length && canUndoLastPly(this.d, cursor.nodeId);
  }
}

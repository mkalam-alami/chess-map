import { getNode, pathTo } from './tree';
import type { ChessMapData, NodeId } from './types';

/** Rendered board width (px) when the map zoom equals the board's zoom. */
export const NOMINAL_PX = 320;
export const DEFAULT_BOARD_ZOOM = 1.5;

export const rootBoardZoom = (map: ChessMapData): number => map.boardZoom ?? DEFAULT_BOARD_ZOOM;

/** Sum of the log2 size deltas from the root down to the node. */
export const sizeSum = (map: ChessMapData, nodeId: NodeId): number =>
  pathTo(map, nodeId).reduce((s, id) => s + (getNode(map, id).sizeDelta ?? 0), 0);

/** Map zoom at which this node's board renders at NOMINAL_PX. A positive delta means a bigger board (lower zoom). */
export const effectiveBoardZoom = (map: ChessMapData, nodeId: NodeId): number => rootBoardZoom(map) - sizeSum(map, nodeId);

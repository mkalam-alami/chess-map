// Public API of the domain layer. Everything not exported here (tree surgery, cursor helpers, caches) is private.
export { DEFAULT_CENTER, sameLngLat, wrapLng, wrapNear, type LngLat, type Place } from './geo';
export { newId } from './id';
export { START_FEN, epd, formatLine, inCheck, legalDests, moveLabel, moveSquares, promotionColor, tryMove, turnColor, type MoveInput } from './chess/rules';
export { openingAt, openingText, type OpeningInfo, type OpeningLookup } from './chess/openings';
export {
  LIBRARY_VERSION, SHAPE_BRUSHES,
  type BoardShape, type ChessMapData, type Cursor, type LibraryData, type MapId, type MapNodeData, type Mode, type NodeId, type Orientation, type SavedView, type ShapeBrush,
} from './repertoire/types';
export { sameCursor } from './repertoire/cursor';
export { DEFAULT_BOARD_ZOOM, NOMINAL_PX } from './repertoire/scale';
export { Repertoire } from './repertoire/Repertoire';
export { Library } from './library/Library';
export { libraryStats, type LibraryStats, type RankedCount } from './stats/libraryStats';
export { Session, type Placing, type Relocating } from './session/Session';
export type { DomainEvent } from './session/events';

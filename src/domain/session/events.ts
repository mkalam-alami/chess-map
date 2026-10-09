import type { LngLat } from '../geo';
import type { Cursor, MapId, NodeId } from '../repertoire/types';

/** What an action asks the outside world to do. Pure data: views and the application layer react to it. */
export type DomainEvent =
  /** Views ease the map to the cursor; `keepSize` keeps the board's on-screen size instead of fitting the children. */
  | { type: 'focused'; cursor: Cursor; keepSize: boolean }
  /** Forward had nowhere to go: pulse the children pins. */
  | { type: 'deadEnd' }
  /** Explore: the move is not in the repertoire. */
  | { type: 'rejected'; san: string }
  /** A position was spawned, confirmed or relocated without a place name: it needs reverse geocoding. */
  | { type: 'positionPlaced'; nodeId: NodeId; at: LngLat }
  /** Switched to, created or imported a map. */
  | { type: 'mapEntered'; mapId: MapId };

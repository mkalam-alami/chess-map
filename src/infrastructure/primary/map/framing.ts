import { wrapNear, type NodeId, type Repertoire } from '../../../domain';
import { mercY, type FitPoint } from './viewMath';

// Which markers a "frame the board and what is around it" action must keep in view, and how much room each one needs.

/** No room is reserved around a marker's anchor: the edge margin in `focusOnBoardWithMarkers` is the only spacing. */
const PIN_ROOM = { mx: 0, my: 0 };

/**
 * The markers to frame around the board at `nodeId`: its direct children, and with `pinnedNotes` also every marker, anywhere in the map, whose note is pinned
 * (the starting position wants those landmarks; framing the next moves of a board does not).
 * Offsets are signed, in world units, from the board, along the shortest way round the globe.
 */
export function framingPoints(rep: Repertoire, nodeId: NodeId, opts: { pinnedNotes: boolean }): FitPoint[] {
  const node = rep.node(nodeId);
  const ids = new Set<NodeId>(node.children);
  if (opts.pinnedNotes) for (const n of rep.nodes()) if (n.noteShown && n.note) ids.add(n.id);
  ids.delete(nodeId);
  return [...ids].map((id) => {
    const n = rep.node(id);
    return {
      dx: (wrapNear(n.lngLat[0], node.lngLat[0]) - node.lngLat[0]) / 360,
      dy: mercY(n.lngLat[1]) - mercY(node.lngLat[1]),
      ...PIN_ROOM, // the note box under a marker is deliberately ignored: only the markers themselves are framed
    };
  });
}

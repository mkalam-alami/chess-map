import { wrapNear, type NodeId, type Repertoire } from '../../../domain';
import { mercY, type FitPoint } from './viewMath';

// Which markers a "frame the board and what is around it" action must keep in view, and how much room each one needs.

/** Room (px) a pin needs around its anchor. */
const PIN_ROOM = { mx: 16, my: 16 };
/** Room (px) a marker whose note is pinned to the map needs: its note box sticks out sideways. */
const NOTE_ROOM = { mx: 90, my: 24 };

/**
 * The markers to frame around the board at `nodeId` / `played`: its direct children (only when the cursor is at the end of its
 * moves, since the children hang off the end), and with `pinnedNotes` also every marker, anywhere in the map, whose note is pinned
 * (the starting position wants those landmarks; framing the next moves of a board does not).
 * Offsets are signed, in world units, from the board, along the shortest way round the globe.
 */
export function framingPoints(rep: Repertoire, nodeId: NodeId, played: number, opts: { pinnedNotes: boolean }): FitPoint[] {
  const node = rep.node(nodeId);
  const ids = new Set<NodeId>(played === node.moves.length ? node.children : []);
  if (opts.pinnedNotes) for (const n of rep.nodes()) if (n.noteShown && n.note) ids.add(n.id);
  ids.delete(nodeId);
  return [...ids].map((id) => {
    const n = rep.node(id);
    return {
      dx: (wrapNear(n.lngLat[0], node.lngLat[0]) - node.lngLat[0]) / 360,
      dy: mercY(n.lngLat[1]) - mercY(node.lngLat[1]),
      ...(n.noteShown && n.note ? NOTE_ROOM : PIN_ROOM),
    };
  });
}

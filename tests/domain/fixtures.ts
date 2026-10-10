import { Repertoire, Session, type ChessMapData, type Library, type LngLat, type MapNodeData, type NodeId } from '../../src/domain';
import { activateMap, addMap, libraryOf } from '../../src/domain/library/commands';

export const O: LngLat = [0, 0];

/** A library of `first` (active) and any `others`, built with the internal library commands (the public API has no such plumbing). */
export const libraryWith = (first: Repertoire, ...others: Repertoire[]): Library =>
  activateMap(others.reduce(addMap, libraryOf(first)), first.id);

export { libraryOf };

/** An empty repertoire map named "t", for tests that do not care about its identity. */
export const emptyRep = (name = 't', orientation: 'white' | 'black' = 'white', at: LngLat = O): Repertoire => Repertoire.create(name, orientation, at);

/** An Edit session on `rep` (a single-map library). */
export const editSession = (rep: Repertoire = emptyRep()): Session => Session.start(libraryOf(rep), 'edit');

/** An Explore session on a map that already has moves. */
export const exploreSession = (rep: Repertoire): Session => Session.start(libraryOf(rep), 'explore');

/** Like the user: plays `san` at the end of `parent`, drops the marker at `at` and confirms. Leaves the cursor on `parent`'s end. */
export function spawn(session: Session, parent: NodeId, san: string, at: LngLat, tail?: LngLat): { session: Session; id: NodeId } {
  const placing = session.goTo(session.repertoire.endOf(parent)).play(san, tail ? [at, tail] : [at]);
  if (!placing.placing) throw new Error(`spawn: "${san}" did not enter placing`);
  const next = placing.confirmPlacing();
  const rep = next.repertoire;
  const id = rep.node(parent).children.find((c) => rep.node(c).moves[0] === san);
  if (!id) throw new Error(`spawn: no child "${san}"`);
  return { session: next, id };
}

/** root -> sans[0] -> sans[1] ... as 1-move markers. `ids[0]` is the root; marker i sits at [i, i]. */
export function lineOf(sans: string[], base: Repertoire = emptyRep()): { session: Session; map: ChessMapData; ids: NodeId[] } {
  let session = editSession(base);
  const ids: NodeId[] = [base.rootId];
  sans.forEach((san, i) => {
    const r = spawn(session, ids[i] as NodeId, san, [i + 1, i + 1]);
    session = r.session;
    ids.push(r.id);
  });
  return { session, map: session.repertoire.data, ids };
}

/** root -> one pinned segment holding all of `sans`, recorded the way the user does (recording on, play each move). */
export function pinnedOf(sans: string[], base: Repertoire = emptyRep()): { session: Session; map: ChessMapData; id: NodeId } {
  let session = editSession(base).toggleRecording();
  for (const san of sans) session = session.play(san, [[1, 1]]);
  session = session.toggleRecording();
  return { session, map: session.repertoire.data, id: session.cursor.nodeId };
}

/** Nested moves: `{ e4: { e5: {}, c5: {} }, d4: {} }`. Siblings keep their order (the last one is lastChild). */
export interface Spec { [san: string]: Spec }

/**
 * Builds a map of 1-move markers from a spec. `id('e4 c5')` returns the node reached by that line
 * (`id('')` is the root). Markers get distinct positions [n, n / 2] in creation order.
 */
export function treeOf(spec: Spec, base: Repertoire = emptyRep()): { session: Session; map: ChessMapData; id: (line: string) => NodeId } {
  let session = editSession(base);
  const ids = new Map<string, NodeId>([['', base.rootId]]);
  let n = 0;
  const walk = (s: Spec, parent: string): void => {
    for (const [san, sub] of Object.entries(s)) {
      n++;
      const r = spawn(session, ids.get(parent) as NodeId, san, [n, n / 2]);
      session = r.session;
      const line = parent ? `${parent} ${san}` : san;
      ids.set(line, r.id);
      walk(sub, line);
    }
  };
  walk(spec, '');
  return {
    session,
    map: session.repertoire.data,
    id: (line) => {
      const found = ids.get(line);
      if (!found) throw new Error(`No node for "${line}"`);
      return found;
    },
  };
}

/** The i-th child node of `id`. */
export const childOf = (map: ChessMapData, id: NodeId, i = 0): MapNodeData => {
  const rep = Repertoire.fromData(map);
  return rep.node(rep.node(id).children[i] as NodeId);
};

/** Replaces fields of one node, bypassing the domain's rules (for hand-made edge cases). */
export const patchNode = (rep: Repertoire, id: NodeId, patch: Partial<MapNodeData>): Repertoire =>
  Repertoire.fromData({ ...rep.data, nodes: { ...rep.data.nodes, [id]: { ...rep.node(id), ...patch } } });


import { describe, expect, it } from 'vitest';
import { DEFAULT_CENTER, Library, Repertoire, Session, type DomainEvent, type LngLat, type NodeId } from '../../src/domain';
import { O, editSession, emptyRep, exploreSession, libraryOf, libraryWith, lineOf, pinnedOf, spawn, treeOf } from './fixtures';

const types = (s: Session): string[] => s.events.map((e) => e.type);
const eventOf = <T extends DomainEvent['type']>(s: Session, type: T): Extract<DomainEvent, { type: T }> =>
  s.events.find((e) => e.type === type) as Extract<DomainEvent, { type: T }>;
const children = (s: Session, id: NodeId): string[] => s.repertoire.node(id).children.map((c) => s.repertoire.node(c).moves.join(' '));
const rootOf = (s: Session): NodeId => s.repertoire.rootId;
/** The user plays `san` in Edit and drops the marker at `at`. */
const place = (s: Session, san: string, at: LngLat = [5, 5], tail?: LngLat): Session => s.play(san, tail ? [at, tail] : [at]).confirmPlacing();
const lastChildId = (s: Session, id: NodeId): NodeId => s.repertoire.node(id).children.at(-1) as NodeId;

/** A repertoire with 1.e4 e5 (two markers), explored from the start. */
const e4e5 = () => lineOf(['e4', 'e5']);

describe('starting a session', () => {
  it('opens on the root of the active map with no flow in progress and no events', () => {
    const s = Session.start(Library.initial());
    expect(s.cursor).toEqual(s.repertoire.rootCursor());
    expect(s).toMatchObject({ recording: false, placing: null, relocating: null, events: [], busy: false });
  });

  it('an empty repertoire forces Edit, whatever mode was asked for', () => {
    expect(Session.start(Library.initial(), 'explore').mode).toBe('edit');
    expect(Session.start(Library.initial(), 'edit').mode).toBe('edit');
    expect(Session.start(Library.initial()).mode).toBe('edit');
    expect(Session.empty().mode).toBe('edit');
    expect(Session.empty('explore').mode).toBe('edit');
  });

  it('a repertoire with moves opens in the preferred mode, Explore by default', () => {
    const rep = Repertoire.fromData(lineOf(['e4']).map);
    expect(Session.start(libraryOf(rep), 'edit').mode).toBe('edit');
    expect(Session.start(libraryOf(rep), 'explore').mode).toBe('explore');
    expect(Session.start(libraryOf(rep), null).mode).toBe('explore');
    expect(Session.start(libraryOf(rep)).mode).toBe('explore');
  });

  it('opens on the active map when the library has several', () => {
    const a = Repertoire.fromData(lineOf(['e4']).map);
    const b = emptyRep('B');
    const s = Session.start(libraryWith(a, b), 'explore');
    expect(s.repertoire.id).toBe(a.id);
    expect(s.mode).toBe('explore');
  });
});

describe('navigating', () => {
  it('goTo moves the cursor and emits focused', () => {
    const { session, ids } = e4e5();
    const to = { nodeId: ids[1] as string, played: 1 };
    const s = session.goTo(to);
    expect(s.cursor).toEqual(to);
    expect(s.events).toEqual([{ type: 'focused', cursor: to, keepSize: false }]);
  });

  it('goTo can ask to keep the on-screen board size', () => {
    const { session, ids } = e4e5();
    expect(eventOf(session.goTo({ nodeId: ids[1] as string, played: 1 }, { keepSize: true }), 'focused').keepSize).toBe(true);
  });

  it('goTo to an unknown node throws', () => {
    expect(() => editSession().goTo({ nodeId: 'ghost', played: 1 })).toThrow(/Unknown node/);
  });

  it('goTo the current cursor still focuses (views re-center)', () => {
    const s = editSession();
    expect(types(s.goTo(s.cursor))).toEqual(['focused']);
  });

  it('back and forward step one move at a time, keeping the board size on screen', () => {
    const { session, id } = pinnedOf(['e4', 'e5', 'Nf3']);
    expect(session.cursor).toEqual({ nodeId: id, played: 3 });
    const b = session.back();
    expect(b.cursor).toEqual({ nodeId: id, played: 2 });
    expect(b.events).toEqual([{ type: 'focused', cursor: b.cursor, keepSize: true }]);
    const f = b.forward();
    expect(f.cursor).toEqual({ nodeId: id, played: 3 });
    expect(eventOf(f, 'focused').keepSize).toBe(true);
  });

  it('back from a marker goes to the end of its parent', () => {
    const { session, ids } = e4e5();
    const s = session.goTo({ nodeId: ids[2] as string, played: 1 }).back();
    expect(s.cursor).toEqual({ nodeId: ids[1], played: 1 });
  });

  it('back at the start position does nothing (same session, no events)', () => {
    const s = editSession();
    expect(s.back()).toBe(s);
  });

  it('forward at a dead end keeps the cursor and emits deadEnd', () => {
    const { session, ids } = e4e5();
    const end = session.goTo({ nodeId: ids[2] as string, played: 1 });
    const s = end.forward();
    expect(s.cursor).toEqual(end.cursor);
    expect(s.events).toEqual([{ type: 'deadEnd' }]);
  });

  it('forward does nothing by default: no future line is picked', () => {
    const t = treeOf({ e4: { e5: {} }, d4: {} });
    const s = exploreSession(t.session.repertoire).forward();
    expect(types(s)).toEqual(['deadEnd']);
    expect(s.future).toEqual([]);
  });

  it('stepping back keeps the line just left, and forward walks it again', () => {
    const t = treeOf({ e4: { e5: {} }, d4: {} });
    const e4 = { nodeId: t.id('e4'), played: 1 };
    const e5 = { nodeId: t.id('e4 e5'), played: 1 };
    const back = exploreSession(t.session.repertoire).goTo(e5).back().back();
    expect(back.cursor).toEqual(back.repertoire.rootCursor());
    expect(back.future).toEqual([e4, e5]);
    const once = back.forward();
    expect(once.cursor).toEqual(e4);
    expect(once.future).toEqual([e5]);
  });

  it('jumping to a marker or move on the line keeps the future, jumping elsewhere drops it', () => {
    const t = treeOf({ e4: { e5: {} }, d4: {} });
    const e4 = { nodeId: t.id('e4'), played: 1 };
    const e5 = { nodeId: t.id('e4 e5'), played: 1 };
    const atRoot = exploreSession(t.session.repertoire).goTo(e5).goTo(t.session.repertoire.rootCursor());
    expect(atRoot.future).toEqual([e4, e5]);
    expect(atRoot.goTo(e5).future).toEqual([]);
    expect(atRoot.goTo({ nodeId: t.id('d4'), played: 1 }).future).toEqual([]);
  });

  it('playing a move forgets the future, even the move the future held', () => {
    const t = treeOf({ e4: { e5: {} }, d4: {} });
    const back = exploreSession(t.session.repertoire).goTo({ nodeId: t.id('e4 e5'), played: 1 }).back().back();
    expect(back.future).toHaveLength(2);
    const played = back.play('e4');
    expect(played.cursor).toEqual({ nodeId: t.id('e4'), played: 1 });
    expect(played.future).toEqual([]);
    expect(played.forward().events).toEqual([{ type: 'deadEnd' }]);
  });

  it('every navigation action is refused while a move is being placed or a location set', () => {
    const { session, ids } = e4e5();
    const edit = session.goTo({ nodeId: ids[1] as string, played: 1 });
    const placing = edit.play('c5', [O]);
    const relocating = edit.startRelocating(null);
    for (const busy of [placing, relocating]) {
      expect(busy.busy).toBe(true);
      expect(busy.goTo(session.repertoire.rootCursor())).toBe(busy);
      expect(busy.back()).toBe(busy);
      expect(busy.forward()).toBe(busy);
    }
  });
});

describe('modes', () => {
  it('switchMode and toggleMode flip between Explore and Edit without events', () => {
    const rep = Repertoire.fromData(lineOf(['e4']).map);
    const s = exploreSession(rep);
    const e = s.switchMode('edit');
    expect(e.mode).toBe('edit');
    expect(e.events).toEqual([]);
    expect(e.toggleMode().mode).toBe('explore');
    expect(s.toggleMode().mode).toBe('edit');
  });

  it('asking for the current mode changes nothing', () => {
    const s = exploreSession(Repertoire.fromData(lineOf(['e4']).map));
    expect(s.switchMode('explore')).toBe(s);
  });

  it('mode changes wait for a placing or relocating flow', () => {
    const edit = editSession();
    const placing = edit.play('e4', [O]);
    expect(placing.switchMode('explore')).toBe(placing);
    expect(placing.toggleMode()).toBe(placing);
    const relocating = edit.startRelocating(null);
    expect(relocating.switchMode('explore')).toBe(relocating);
  });

  it('recording toggles on and off, even during a transient flow', () => {
    const s = editSession();
    expect(s.toggleRecording().recording).toBe(true);
    expect(s.toggleRecording().toggleRecording().recording).toBe(false);
    expect(s.play('e4', [O]).toggleRecording().recording).toBe(true);
    expect(s.startRelocating(null).toggleRecording().recording).toBe(true);
  });

  it('recording survives a mode switch', () => {
    const s = exploreSession(Repertoire.fromData(lineOf(['e4']).map)).switchMode('edit').toggleRecording();
    expect(s.switchMode('explore').recording).toBe(true);
  });
});

describe('exploring (training)', () => {
  const rep = () => Repertoire.fromData(treeOf({ e4: { e5: {} }, d4: {} }).map);

  it('follows a repertoire move and focuses it', () => {
    const s = exploreSession(rep()).play('e4');
    expect(s.cursor.played).toBe(1);
    expect(s.repertoire.sanPath(s.cursor)).toEqual(['e4']);
    expect(types(s)).toEqual(['focused']);
    expect(eventOf(s, 'focused')).toMatchObject({ cursor: s.cursor, keepSize: false });
  });

  it('rejects a move that is not in the repertoire: nothing changes, rejected is emitted', () => {
    const before = exploreSession(rep());
    const s = before.play('c4');
    expect(s.events).toEqual([{ type: 'rejected', san: 'c4' }]);
    expect(s.cursor).toEqual(before.cursor);
    expect(s.library).toBe(before.library);
  });

  it('never creates anything, even when asked to spawn at a spot', () => {
    const before = exploreSession(rep());
    const s = before.play('c4', [[1, 1]]);
    expect(s.repertoire.data).toBe(before.repertoire.data);
    expect(s.placing).toBeNull();
  });

  it('ignores the recording toggle', () => {
    const s = exploreSession(rep()).toggleRecording().play('c4');
    expect(types(s)).toEqual(['rejected']);
  });

  it('follows a move inside a pinned segment', () => {
    const p = pinnedOf(['e4', 'e5', 'Nf3']);
    const s = exploreSession(p.session.repertoire).play('e4').play('e5');
    expect(s.cursor).toEqual({ nodeId: p.id, played: 2 });
  });

  it('a followed move is still blocked while a location is being set', () => {
    const s = exploreSession(rep()).startRelocating(null);
    const next = s.play('e4');
    expect(next).toBe(s);
    expect(next.events).toEqual([]);
  });

  it('a rejected move is reported even while a location is being set', () => {
    expect(types(exploreSession(rep()).startRelocating(null).play('c4'))).toEqual(['rejected']);
  });

  it('moveExists tells whether a move is already in the tree here', () => {
    const s = exploreSession(rep());
    expect(s.moveExists('e4')).toBe(true);
    expect(s.moveExists('c4')).toBe(false);
    expect(s.play('e4').moveExists('e5')).toBe(true);
    expect(s.play('e4').moveExists('d4')).toBe(false);
  });
});

describe('editing: playing moves', () => {
  it('a new move enters placing at the first spot, with the tail spot as second; nothing is created yet', () => {
    const s = editSession().play('e4', [[10, 20], [30, 40]]);
    expect(s.placing).toEqual({ parentCursor: s.repertoire.rootCursor(), san: 'e4', lngLat: [10, 20], tailLngLat: [30, 40] });
    expect(s.repertoire.nodes()).toHaveLength(1);
    expect(s.events).toEqual([]);
    expect(s.busy).toBe(true);
  });

  it('without spots the ghost starts on the current position, tail included', () => {
    const rep = emptyRep('t', 'white', [7, 8]);
    const s = editSession(rep).play('e4');
    expect(s.placing).toMatchObject({ lngLat: [7, 8], tailLngLat: [7, 8] });
  });

  it('without a tail spot the tail follows the first spot', () => {
    expect(editSession().play('e4', [[10, 20]]).placing).toMatchObject({ lngLat: [10, 20], tailLngLat: [10, 20] });
  });

  it('a move already in the tree just navigates there (no placing, no new node)', () => {
    const { session, ids } = e4e5();
    const edit = session.goTo(session.repertoire.rootCursor());
    const s = edit.play('e4', [[1, 1]]);
    expect(s.cursor).toEqual({ nodeId: ids[1], played: 1 });
    expect(s.placing).toBeNull();
    expect(types(s)).toEqual(['focused']);
    expect(s.repertoire.data).toBe(edit.repertoire.data);
  });

  it('a move inside an existing segment navigates along it', () => {
    const p = pinnedOf(['e4', 'e5', 'Nf3']);
    const s = p.session.goTo(p.session.repertoire.rootCursor()).play('e4').play('e5');
    expect(s.cursor).toEqual({ nodeId: p.id, played: 2 });
    expect(s.placing).toBeNull();
  });

  it('a move is refused while another one is being placed', () => {
    const s = editSession().play('e4', [O]);
    expect(s.play('d4', [O])).toBe(s);
  });

  it('a move is accepted while a location is being set (the board stays interactive)', () => {
    const s = editSession().startRelocating(null).play('e4', [O]);
    expect(s.placing?.san).toBe('e4');
    expect(s.relocating).not.toBeNull();
  });
});

describe('editing: placing flow', () => {
  it('movePlacing moves the ghost only: no events, nothing else changes', () => {
    const s = editSession().play('e4', [[1, 1], [2, 2]]);
    const m = s.movePlacing([9, 9]);
    expect(m.placing).toEqual({ ...s.placing, lngLat: [9, 9] });
    expect(m.events).toEqual([]);
    expect(m.library).toBe(s.library);
  });

  it('movePlacing without a move being placed does nothing', () => {
    const s = editSession();
    expect(s.movePlacing([1, 1])).toBe(s);
  });

  it('confirming drops the marker where the ghost is, keeps the cursor, and asks for a place name', () => {
    const s = editSession().play('e4', [[1, 1]]).movePlacing([15, 25]).confirmPlacing();
    const id = lastChildId(s, rootOf(s));
    expect(s.repertoire.node(id)).toMatchObject({ moves: ['e4'], pinned: false, lngLat: [15, 25] });
    expect(s.cursor).toEqual(s.repertoire.rootCursor()); // stays: the user can keep spawning alternatives
    expect(s.placing).toBeNull();
    expect(s.events).toEqual([{ type: 'positionPlaced', nodeId: id, at: [15, 25] }]);
  });

  it('the new marker becomes the last child (what forward follows)', () => {
    const t = treeOf({ e4: {} });
    const s = place(t.session, 'd4');
    expect(s.repertoire.node(rootOf(s)).lastChild).toBe(lastChildId(s, rootOf(s)));
    expect(children(s, rootOf(s))).toEqual(['e4', 'd4']);
  });

  it('cancelling throws the move away without a trace', () => {
    const before = editSession();
    const s = before.play('e4', [[1, 1]]).cancelPlacing();
    expect(s.placing).toBeNull();
    expect(s.events).toEqual([]);
    expect(s.repertoire.data).toBe(before.repertoire.data);
    expect(s.busy).toBe(false);
  });

  it('confirming or cancelling with nothing to place does nothing', () => {
    const s = editSession();
    expect(s.confirmPlacing()).toBe(s);
    expect(s.cancelPlacing()).toBe(s);
  });

  it('navigation works again after confirming or cancelling', () => {
    const placing = editSession().play('e4', [O]);
    expect(placing.cancelPlacing().busy).toBe(false);
    const confirmed = placing.confirmPlacing();
    const child = { nodeId: lastChildId(confirmed, rootOf(confirmed)), played: 1 };
    expect(confirmed.goTo(child).cursor).toEqual(child);
  });

  it('placing a move mid-segment splits the segment and relocates the split-off tail to the second spot', () => {
    const p = pinnedOf(['e4', 'e5', 'Nf3']);
    const s = p.session.goTo({ nodeId: p.id, played: 1 });
    const placed = place(s, 'c5', [10, 10], [20, 30]);
    const head = placed.repertoire.node(p.id);
    expect(head.moves).toEqual(['e4']);
    const [tail, fresh] = head.children.map((c) => placed.repertoire.node(c));
    expect(tail).toMatchObject({ moves: ['e5', 'Nf3'], pinned: true, lngLat: [20, 30] });
    expect(fresh).toMatchObject({ moves: ['c5'], lngLat: [10, 10] });
    expect(eventOf(placed, 'positionPlaced')).toMatchObject({ nodeId: fresh?.id, at: [10, 10] });
    expect(placed.cursor).toEqual({ nodeId: p.id, played: 1 }); // stays on the head
  });

  it('the relocated tail takes its whole branch with it', () => {
    const p = pinnedOf(['e4', 'e5']);
    const withChild = place(p.session, 'Nf3', [3, 3]);
    const child = lastChildId(withChild, p.id);
    const placed = place(withChild.goTo({ nodeId: p.id, played: 1 }), 'c5', [10, 10], [40, 50]);
    const tail = placed.repertoire.node(placed.repertoire.node(p.id).children[0] as string);
    expect(tail.lngLat).toEqual([40, 50]);
    expect(placed.repertoire.node(child).lngLat).toEqual([40 + (3 - 1), 50 + (3 - 1)]); // pinned head sat at [1, 1]
  });

  it('without a tail spot the tail goes to the new marker\'s spot', () => {
    const p = pinnedOf(['e4', 'e5']);
    const placed = place(p.session.goTo({ nodeId: p.id, played: 1 }), 'c5', [10, 10]);
    expect(placed.repertoire.node(placed.repertoire.node(p.id).children[0] as string).lngLat).toEqual([10, 10]);
  });

  it('a split tail keeps the pin / place of the segment and the head keeps its note', () => {
    const p = pinnedOf(['e4', 'e5']);
    const named = p.session.nameLocation(p.id, { label: 'Paris' }).annotate(p.id, 'hello');
    const placed = place(named.goTo({ nodeId: p.id, played: 1 }), 'c5', [10, 10]);
    expect(placed.repertoire.node(p.id).note).toBe('hello');
    expect(placed.repertoire.node(placed.repertoire.node(p.id).children[0] as string).place).toEqual({ label: 'Paris' });
  });
});

describe('editing: where new markers may go', () => {
  it('latitude is clamped to +-60 degrees at root scale', () => {
    const north = place(editSession(), 'e4', [10, 85]);
    expect(north.repertoire.node(lastChildId(north, rootOf(north))).lngLat).toEqual([10, 60]);
    const south = place(editSession(), 'e4', [10, -85]);
    expect(south.repertoire.node(lastChildId(south, rootOf(south))).lngLat).toEqual([10, -60]);
    expect(eventOf(north, 'positionPlaced').at).toEqual([10, 60]);
  });

  it('latitude is clamped to +-80 when the board was rescaled', () => {
    const { session, ids } = lineOf(['e4']);
    const e4 = ids[1] as string;
    const at = (s: Session): Session => s.goTo(s.repertoire.endOf(e4));
    const big = place(at(session.resizeBoard(e4, 1)), 'e5', [10, 85]);
    expect(big.repertoire.node(lastChildId(big, e4)).lngLat).toEqual([10, 80]);
    const shrunk = place(at(session.resizeBoard(e4, -1)), 'e5', [10, -85]);
    expect(shrunk.repertoire.node(lastChildId(shrunk, e4)).lngLat).toEqual([10, -80]);
  });

  it('a board that went back to nominal size is at root scale again', () => {
    const { session, ids } = lineOf(['e4']);
    const e4 = ids[1] as string;
    const back = session.resizeBoard(e4, 1).resizeBoard(e4, 0);
    const placed = place(back.goTo(back.repertoire.endOf(e4)), 'e5', [10, 85]);
    expect(placed.repertoire.node(lastChildId(placed, e4)).lngLat[1]).toBe(60);
  });

  it('longitude is wrapped into [-180, 180)', () => {
    const east = place(editSession(), 'e4', [190, 10]);
    expect(east.repertoire.node(lastChildId(east, rootOf(east))).lngLat).toEqual([-170, 10]);
    const west = place(editSession(), 'e4', [-190, 10]);
    expect(west.repertoire.node(lastChildId(west, rootOf(west))).lngLat).toEqual([170, 10]);
  });

  it('the split tail spot is clamped the same way', () => {
    const p = pinnedOf(['e4', 'e5']);
    const placed = place(p.session.goTo({ nodeId: p.id, played: 1 }), 'c5', [10, 10], [200, 99]);
    expect(placed.repertoire.node(placed.repertoire.node(p.id).children[0] as string).lngLat).toEqual([-160, 60]);
  });
});

describe('editing: recording', () => {
  it('the first recorded move spawns a pinned marker and focuses it, without placing', () => {
    const s = editSession().toggleRecording().play('e4', [[4, 5]]);
    const id = lastChildId(s, rootOf(s));
    expect(s.repertoire.node(id)).toMatchObject({ moves: ['e4'], pinned: true, lngLat: [4, 5] });
    expect(s.cursor).toEqual({ nodeId: id, played: 1 });
    expect(s.placing).toBeNull();
    expect(types(s)).toEqual(['focused', 'positionPlaced']);
    expect(eventOf(s, 'focused')).toEqual({ type: 'focused', cursor: s.cursor, keepSize: false });
    expect(eventOf(s, 'positionPlaced')).toEqual({ type: 'positionPlaced', nodeId: id, at: [4, 5] });
  });

  it('following moves extend the segment: the cursor advances and no events are emitted', () => {
    const s1 = editSession().toggleRecording().play('e4', [[4, 5]]);
    const s2 = s1.play('e5', [[9, 9]]);
    const id = s1.cursor.nodeId;
    expect(s2.repertoire.node(id).moves).toEqual(['e4', 'e5']);
    expect(s2.cursor).toEqual({ nodeId: id, played: 2 });
    expect(s2.events).toEqual([]);
    expect(s2.repertoire.nodes()).toHaveLength(2);
  });

  it('recording at the end of an unpinned leaf pins it and extends it', () => {
    const { session, ids } = lineOf(['e4']);
    const s = session.goTo(session.repertoire.endOf(ids[1] as string)).toggleRecording().play('e5');
    expect(s.repertoire.node(ids[1] as string)).toMatchObject({ moves: ['e4', 'e5'], pinned: true });
    expect(s.cursor).toEqual({ nodeId: ids[1], played: 2 });
  });

  it('recording at a node with children spawns a new pinned child instead', () => {
    const { session, ids } = lineOf(['e4', 'e5']);
    const s = session.goTo(session.repertoire.endOf(ids[1] as string)).toggleRecording().play('c5', [[7, 7]]);
    expect(s.repertoire.node(ids[1] as string).moves).toEqual(['e4']);
    const id = lastChildId(s, ids[1] as string);
    expect(s.repertoire.node(id)).toMatchObject({ moves: ['c5'], pinned: true });
    expect(s.cursor).toEqual({ nodeId: id, played: 1 });
  });

  it('recording a move that already exists just navigates', () => {
    const { session, ids } = e4e5();
    const s = session.goTo(session.repertoire.rootCursor()).toggleRecording().play('e4', [O]);
    expect(s.cursor).toEqual({ nodeId: ids[1], played: 1 });
    expect(types(s)).toEqual(['focused']);
  });

  it('recording mid-segment with a new move splits the segment and moves into the new pinned branch', () => {
    const p = pinnedOf(['e4', 'e5', 'Nf3']);
    const s = p.session.goTo({ nodeId: p.id, played: 2 }).toggleRecording().play('f4', [[10, 10], [20, 20]]);
    const head = s.repertoire.node(p.id);
    expect(head.moves).toEqual(['e4', 'e5']);
    const [tail, fresh] = head.children.map((c) => s.repertoire.node(c));
    expect(tail).toMatchObject({ moves: ['Nf3'], lngLat: [20, 20] });
    expect(fresh).toMatchObject({ moves: ['f4'], pinned: true });
    expect(s.cursor).toEqual({ nodeId: fresh?.id, played: 1 });
    expect(types(s)).toEqual(['focused', 'positionPlaced']);
  });

  it('recording at the root never extends the root', () => {
    const s = editSession().toggleRecording().play('e4');
    expect(s.repertoire.node(rootOf(s)).moves).toEqual([]);
  });

  it('with recording off the same move goes through placing', () => {
    expect(editSession().play('e4', [O]).placing).not.toBeNull();
  });

  it('turning recording on while a move waits in placing records it when confirmed', () => {
    const s = editSession().play('e4', [[4, 5]]).toggleRecording().confirmPlacing();
    const id = lastChildId(s, rootOf(s));
    expect(s.repertoire.node(id).pinned).toBe(true);
    expect(s.cursor).toEqual({ nodeId: id, played: 1 });
  });
});

describe('taking a move back', () => {
  it('drops the last move of the segment the cursor is at the end of', () => {
    const p = pinnedOf(['e4', 'e5', 'Nf3']);
    expect(p.session.canTakeBack).toBe(true);
    const s = p.session.takeBack();
    expect(s.repertoire.node(p.id).moves).toEqual(['e4', 'e5']);
    expect(s.cursor).toEqual({ nodeId: p.id, played: 2 });
    expect(s.events).toEqual([]);
  });

  it('a marker keeps at least one move: use deletePosition to remove it', () => {
    const p = pinnedOf(['e4', 'e5']);
    const one = p.session.takeBack();
    expect(one.canTakeBack).toBe(false);
    expect(one.takeBack()).toBe(one);
  });

  it('is refused mid-segment, on nodes with children and at the start position', () => {
    const p = pinnedOf(['e4', 'e5', 'Nf3']);
    const mid = p.session.goTo({ nodeId: p.id, played: 2 });
    expect(mid.canTakeBack).toBe(false);
    expect(mid.takeBack()).toBe(mid);
    const withChild = place(p.session, 'Nc6');
    const atParent = withChild.goTo(withChild.repertoire.endOf(p.id));
    expect(atParent.canTakeBack).toBe(false);
    expect(atParent.takeBack()).toBe(atParent);
    const start = editSession();
    expect(start.canTakeBack).toBe(false);
    expect(start.takeBack()).toBe(start);
  });

  it('is refused while a location is being set or a move is being placed', () => {
    const p = pinnedOf(['e4', 'e5']);
    const relocating = p.session.startRelocating(null);
    expect(relocating.canTakeBack).toBe(false);
    expect(relocating.takeBack()).toBe(relocating);
    const placing = p.session.play('Nf3', [O]);
    expect(placing.canTakeBack).toBe(false);
    expect(placing.takeBack()).toBe(placing);
  });

  it('after taking back, the recording continues from the shorter line', () => {
    const p = pinnedOf(['e4', 'e5', 'Nf3']);
    const s = p.session.takeBack().toggleRecording().play('Nc6');
    expect(s.repertoire.node(p.id).moves).toEqual(['e4', 'e5', 'Nc6']);
  });
});

describe('set-location flow', () => {
  it('starts on a node (Edit only) with no preview, and ends again', () => {
    const { session, ids } = e4e5();
    const s = session.startRelocating(ids[1] as string);
    expect(s.relocating).toEqual({ nodeId: ids[1], preview: null });
    expect(s.busy).toBe(true);
    expect(s.endRelocating().relocating).toBeNull();
    expect(s.endRelocating().busy).toBe(false);
  });

  it('Explore may only go to a place (no target node)', () => {
    const { session, ids } = e4e5();
    const explore = session.switchMode('explore');
    expect(explore.startRelocating(ids[1] as string)).toBe(explore);
    expect(explore.startRelocating(null).relocating).toEqual({ nodeId: null, preview: null });
  });

  it('is refused while a move is being placed', () => {
    const placing = editSession().play('e4', [O]);
    expect(placing.startRelocating(null)).toBe(placing);
    expect(placing.startRelocating(rootOf(placing))).toBe(placing);
  });

  it('an unknown target throws', () => {
    expect(() => editSession().startRelocating('ghost')).toThrow(/Unknown node/);
  });

  it('previews a candidate place, and clears it', () => {
    const { session, ids } = e4e5();
    const s = session.startRelocating(ids[1] as string).previewRelocation([5, 6]);
    expect(s.relocating).toEqual({ nodeId: ids[1], preview: [5, 6] });
    expect(s.previewRelocation(null).relocating).toEqual({ nodeId: ids[1], preview: null });
  });

  it('previewing or ending without the flow does nothing', () => {
    const s = editSession();
    expect(s.previewRelocation([1, 1])).toBe(s);
    expect(s.endRelocating()).toBe(s);
  });

  it('relocating a node keeps the flow open until it is ended explicitly', () => {
    const { session, ids } = e4e5();
    const s = session.startRelocating(ids[1] as string).relocate(ids[1] as string, [3, 4], { place: { label: 'Lisbon' } });
    expect(s.relocating).not.toBeNull();
    expect(s.endRelocating().busy).toBe(false);
  });
});

describe('relocating a position', () => {
  it('moves it and asks for its place name', () => {
    const { session, ids } = e4e5();
    const s = session.relocate(ids[1] as string, [30, 40]);
    expect(s.repertoire.node(ids[1] as string).lngLat).toEqual([30, 40]);
    expect(s.repertoire.node(ids[2] as string).lngLat).toEqual([2, 2]); // the branch stays
    expect(s.events).toEqual([{ type: 'positionPlaced', nodeId: ids[1], at: [30, 40] }]);
  });

  it('wraps the longitude (also in the event)', () => {
    const { session, ids } = e4e5();
    const s = session.relocate(ids[1] as string, [190, 10]);
    expect(s.repertoire.node(ids[1] as string).lngLat).toEqual([-170, 10]);
    expect(eventOf(s, 'positionPlaced').at).toEqual([-170, 10]);
  });

  it('does not clamp the latitude: only spawning does', () => {
    const { session, ids } = e4e5();
    expect(session.relocate(ids[1] as string, [10, 85]).repertoire.node(ids[1] as string).lngLat).toEqual([10, 85]);
  });

  it('with the whole branch, everything below moves by the same offset', () => {
    const { session, ids } = lineOf(['e4', 'e5', 'Nf3']);
    const s = session.relocate(ids[1] as string, [11, 21], { withBranch: true });
    expect([1, 2, 3].map((i) => s.repertoire.node(ids[i] as string).lngLat)).toEqual([[11, 21], [12, 22], [13, 23]]);
    expect(s.repertoire.node(ids[0] as string).lngLat).toEqual(O);
  });

  it('with the whole branch, every moved position asks for its place name, at a wrapped position', () => {
    const { session, ids } = lineOf(['e4', 'e5', 'Nf3']);
    const s = session.relocate(ids[1] as string, [179, 21], { withBranch: true });
    expect(s.events).toEqual([
      { type: 'positionPlaced', nodeId: ids[1], at: [179, 21] },
      { type: 'positionPlaced', nodeId: ids[2], at: [-180, 22] },
      { type: 'positionPlaced', nodeId: ids[3], at: [-179, 23] },
    ]);
    // a name arriving for a moved descendant is accepted although its stored longitude is not wrapped
    expect(s.nameLocation(ids[2] as string, { label: 'Fiji' }, [-180, 22]).repertoire.node(ids[2] as string).place?.label).toBe('Fiji');
  });

  it('with a place (e.g. a search result) the label is set directly and no geocoding is requested', () => {
    const { session, ids } = e4e5();
    const s = session.relocate(ids[1] as string, [30, 40], { place: { label: 'Lisbon', country: 'Portugal' } });
    expect(s.repertoire.node(ids[1] as string).place).toEqual({ label: 'Lisbon', country: 'Portugal' });
    expect(s.events).toEqual([]);
  });

  it('can move the root board too', () => {
    const before = editSession();
    const s = before.relocate(before.repertoire.rootId, [1, 2]);
    expect(s.repertoire.node(s.repertoire.rootId).lngLat).toEqual([1, 2]);
  });

  it('an unknown node throws', () => {
    expect(() => editSession().relocate('ghost', [1, 1])).toThrow(/Unknown node/);
  });
});

describe('naming a location (geocoder result)', () => {
  it('sets the place of the node', () => {
    const { session, ids } = e4e5();
    const s = session.nameLocation(ids[1] as string, { label: 'Paris', country: 'France' });
    expect(s.repertoire.node(ids[1] as string).place).toEqual({ label: 'Paris', country: 'France' });
    expect(s.events).toEqual([]);
  });

  it('is ignored when the node no longer exists', () => {
    const { session, ids } = e4e5();
    const gone = session.deletePosition(ids[2] as string);
    expect(gone.nameLocation(ids[2] as string, { label: 'Paris' })).toBe(gone);
  });

  it('is ignored when the node was in a map that is no longer active', () => {
    const { session, ids } = e4e5();
    const other = session.createMap('Other', 'white');
    expect(other.nameLocation(ids[1] as string, { label: 'Paris' })).toBe(other);
  });

  it('with requestedAt, applies when the node is still there', () => {
    const { session, ids } = e4e5();
    const s = session.nameLocation(ids[1] as string, { label: 'Paris' }, [1, 1]);
    expect(s.repertoire.node(ids[1] as string).place).toEqual({ label: 'Paris' });
  });

  it('with requestedAt, tolerates floating-point noise', () => {
    const { session, ids } = e4e5();
    const s = session.nameLocation(ids[1] as string, { label: 'Paris' }, [1 + 1e-9, 1]);
    expect(s.repertoire.node(ids[1] as string).place).toEqual({ label: 'Paris' });
  });

  it('with requestedAt, is ignored when the node moved since the lookup', () => {
    const { session, ids } = e4e5();
    const moved = session.relocate(ids[1] as string, [50, 50], { place: { label: 'Lisbon' } });
    const late = moved.nameLocation(ids[1] as string, { label: 'Open sea' }, [1, 1]);
    expect(late).toBe(moved);
    expect(late.repertoire.node(ids[1] as string).place).toEqual({ label: 'Lisbon' });
  });

  it('without requestedAt, the caller takes responsibility: applies wherever the node is', () => {
    const { session, ids } = e4e5();
    const moved = session.relocate(ids[1] as string, [50, 50]);
    expect(moved.nameLocation(ids[1] as string, { label: 'X' }).repertoire.node(ids[1] as string).place).toEqual({ label: 'X' });
  });

  it('works during a placing flow (it is not a user action)', () => {
    const { session, ids } = e4e5();
    const s = session.play('c5', [O]).nameLocation(ids[1] as string, { label: 'Paris' });
    expect(s.placing).not.toBeNull();
    expect(s.repertoire.node(ids[1] as string).place?.label).toBe('Paris');
  });
});

describe('notes and board size', () => {
  it('annotate sets a note; a blank note removes it', () => {
    const { session, ids } = e4e5();
    const n = session.annotate(ids[1] as string, 'Best by test');
    expect(n.repertoire.node(ids[1] as string).note).toBe('Best by test');
    expect('note' in n.annotate(ids[1] as string, '   ').repertoire.node(ids[1] as string)).toBe(false);
    expect(n.events).toEqual([]);
  });

  it('showNote keeps a note visible on its marker; it needs a note and goes away with it', () => {
    const { session, ids } = e4e5();
    const id = ids[1] as string;
    expect(session.showNote(id, true).repertoire.node(id).noteShown).toBeUndefined(); // nothing to show
    const noted = session.annotate(id, "King's Gambit");
    const shown = noted.showNote(id, true);
    expect(shown.repertoire.node(id).noteShown).toBe(true);
    expect(shown.events).toEqual([]);
    expect('noteShown' in shown.showNote(id, false).repertoire.node(id)).toBe(false);
    expect(shown.annotate(id, 'Other').repertoire.node(id).noteShown).toBe(true); // editing keeps the flag
    expect('noteShown' in shown.annotate(id, '  ').repertoire.node(id)).toBe(false); // removing the note drops it
  });

  it('resizeBoard stores the size relative to the parent, snapped to 0.25', () => {
    const { session, ids } = e4e5();
    expect(session.resizeBoard(ids[1] as string, 0.4).repertoire.node(ids[1] as string).sizeDelta).toBe(0.5);
    expect(session.resizeBoard(ids[1] as string, 0.1).repertoire.node(ids[1] as string).sizeDelta).toBeUndefined();
  });

  it('a rescaled board scales the boards below it too', () => {
    const { session, ids } = e4e5();
    const s = session.resizeBoard(ids[1] as string, 1);
    expect(s.repertoire.effectiveBoardZoom(ids[2] as string)).toBe(s.repertoire.effectiveBoardZoom(ids[1] as string));
    expect(s.repertoire.effectiveBoardZoom(ids[1] as string)).toBeLessThan(s.repertoire.effectiveBoardZoom(rootOf(s)));
  });
});

describe('deleting a position', () => {
  it('removes the position and its branch', () => {
    const t = treeOf({ e4: { e5: { Nf3: {} } }, d4: {} });
    const s = t.session.deletePosition(t.id('e4'));
    expect(s.repertoire.nodes()).toHaveLength(2);
    expect(children(s, rootOf(s))).toEqual(['d4']);
  });

  it('never deletes the root', () => {
    const { session } = e4e5();
    expect(session.deletePosition(rootOf(session))).toBe(session);
  });

  it('an unknown node throws', () => {
    expect(() => editSession().deletePosition('ghost')).toThrow(/Unknown node/);
  });

  it('a cursor elsewhere stays where it is', () => {
    const t = treeOf({ e4: {}, d4: {} });
    const at = t.session.goTo({ nodeId: t.id('d4'), played: 1 });
    const s = at.deletePosition(t.id('e4'));
    expect(s.cursor).toEqual(at.cursor);
    expect(s.events).toEqual([]);
  });

  it('a cursor on the deleted position moves to the end of its parent', () => {
    const { session, ids } = lineOf(['e4', 'e5', 'Nf3']);
    const at = session.goTo({ nodeId: ids[2] as string, played: 1 });
    expect(at.deletePosition(ids[2] as string).cursor).toEqual({ nodeId: ids[1], played: 1 });
  });

  it('a cursor below the deleted position moves to the end of the deleted one\'s parent', () => {
    const { session, ids } = lineOf(['e4', 'e5', 'Nf3']);
    const at = session.goTo({ nodeId: ids[3] as string, played: 1 });
    expect(at.deletePosition(ids[2] as string).cursor).toEqual({ nodeId: ids[1], played: 1 });
  });

  it('the parent end is the end of its whole segment', () => {
    const p = pinnedOf(['e4', 'e5', 'Nf3']);
    const withChild = place(p.session, 'Nc6');
    const child = lastChildId(withChild, p.id);
    const at = withChild.goTo({ nodeId: child, played: 1 });
    expect(at.deletePosition(child).cursor).toEqual({ nodeId: p.id, played: 3 });
  });

  it('deleting a child at the start deletes back to the root cursor', () => {
    const { session, ids } = e4e5();
    const at = session.goTo({ nodeId: ids[1] as string, played: 1 });
    expect(at.deletePosition(ids[1] as string).cursor).toEqual(session.repertoire.rootCursor());
  });

  it('emits no event (the cursor moves silently)', () => {
    const { session, ids } = e4e5();
    expect(session.goTo({ nodeId: ids[2] as string, played: 1 }).deletePosition(ids[2] as string).events).toEqual([]);
  });
});

describe('maps', () => {
  describe('creating', () => {
    it('adds an empty map, makes it active and starts in Edit (an empty repertoire has nothing to explore)', () => {
      const { session } = e4e5();
      const s = session.switchMode('explore').createMap('French', 'black', [5, 6]);
      expect(s.library.size).toBe(2);
      expect(s.repertoire).toMatchObject({ name: 'French', orientation: 'black' });
      expect(s.repertoire.node(s.repertoire.rootId).lngLat).toEqual([5, 6]);
      expect(s.mode).toBe('edit');
      expect(s.cursor).toEqual(s.repertoire.rootCursor());
      expect(s.events).toEqual([{ type: 'mapEntered', mapId: s.repertoire.id }]);
    });

    it('trims the name and falls back to "Untitled"', () => {
      expect(editSession().createMap('  Caro-Kann  ', 'white').repertoire.name).toBe('Caro-Kann');
      expect(editSession().createMap('   ', 'white').repertoire.name).toBe('Untitled');
      expect(editSession().createMap('', 'white').repertoire.name).toBe('Untitled');
    });

    it('starts at the default center, with the longitude wrapped', () => {
      const s = editSession().createMap('A', 'white');
      const at = s.repertoire.node(s.repertoire.rootId).lngLat;
      expect(at[0]).toBeCloseTo(DEFAULT_CENTER[0]);
      expect(at[1]).toBe(DEFAULT_CENTER[1]);
      const w = editSession().createMap('A', 'white', [200, 10]);
      expect(w.repertoire.node(w.repertoire.rootId).lngLat).toEqual([-160, 10]);
    });

    it('resets recording and flows', () => {
      const s = editSession().toggleRecording().startRelocating(null).createMap('A', 'white');
      expect(s).toMatchObject({ recording: false, relocating: null, placing: null });
    });
  });

  describe('switching', () => {
    const two = () => {
      const a = Repertoire.fromData(lineOf(['e4', 'e5']).map);
      const b = Repertoire.fromData(lineOf(['d4']).map);
      return { a, b, session: Session.start(libraryWith(a, b), 'explore') };
    };

    it('shows the other map from its start and emits mapEntered', () => {
      const { b, session } = two();
      const s = session.goTo({ nodeId: session.repertoire.nodes()[1]?.id as string, played: 1 }).switchMap(b.id);
      expect(s.repertoire.id).toBe(b.id);
      expect(s.cursor).toEqual(b.rootCursor());
      expect(s.events).toEqual([{ type: 'mapEntered', mapId: b.id }]);
    });

    it('keeps Explore when the new map has moves, forces Edit when it is empty', () => {
      const { b, session } = two();
      expect(session.switchMap(b.id).mode).toBe('explore');
      const withEmpty = session.createMap('E', 'white').switchMap(b.id).switchMap(session.library.activeId);
      expect(withEmpty.mode).toBe('edit');
    });

    it('switching to the current map re-enters it from its start', () => {
      const { a, session } = two();
      const deep = session.goTo({ nodeId: a.node(a.rootId).children[0] as string, played: 1 });
      const s = deep.switchMap(a.id);
      expect(s.cursor).toEqual(a.rootCursor());
      expect(types(s)).toEqual(['mapEntered']);
    });

    it('an unknown map is refused', () => {
      const { session } = two();
      expect(session.switchMap('ghost')).toBe(session);
    });

    it('drops recording and flows', () => {
      const { b, session } = two();
      const s = session.switchMode('edit').toggleRecording().startRelocating(null).switchMap(b.id);
      expect(s).toMatchObject({ recording: false, relocating: null, placing: null });
    });

    it('works while a move is being placed (the placing is dropped)', () => {
      const { b, session } = two();
      const s = session.switchMode('edit').play('c4', [O]).switchMap(b.id);
      expect(s.placing).toBeNull();
      expect(s.repertoire.id).toBe(b.id);
    });
  });

  describe('adding (import)', () => {
    it('adds the maps and switches to the last one, emitting a single mapEntered', () => {
      const { session } = e4e5();
      const x = emptyRep('X');
      const y = Repertoire.fromData(lineOf(['c4']).map);
      const s = session.addMaps([x, y]);
      expect(s.library.size).toBe(3);
      expect(s.repertoire.id).toBe(y.id);
      expect(s.cursor).toEqual(y.rootCursor());
      expect(s.events).toEqual([{ type: 'mapEntered', mapId: y.id }]);
    });

    it('adding nothing does nothing', () => {
      const { session } = e4e5();
      expect(session.addMaps([])).toBe(session);
    });

    it('an imported empty map opens in Edit', () => {
      const { session } = e4e5();
      expect(session.switchMode('explore').addMaps([emptyRep('X')]).mode).toBe('edit');
    });
  });

  describe('renaming and flipping', () => {
    it('renames the active map, trimming the name', () => {
      const s = editSession().renameMap('  Najdorf ');
      expect(s.repertoire.name).toBe('Najdorf');
      expect(s.events).toEqual([]);
    });

    it('keeps the old name when the new one is blank', () => {
      const s = editSession(emptyRep('Keep'));
      expect(s.renameMap('   ').repertoire.name).toBe('Keep');
      expect(s.renameMap('').repertoire.name).toBe('Keep');
    });

    it('flips the orientation of the active map only', () => {
      const s = editSession().createMap('B', 'white');
      const flipped = s.flipOrientation();
      expect(flipped.repertoire.orientation).toBe('black');
      expect(flipped.flipOrientation().repertoire.orientation).toBe('white');
      expect(flipped.library.repertoires().filter((r) => r.orientation === 'black')).toHaveLength(1);
    });

    it('does not move the cursor', () => {
      const { session, ids } = e4e5();
      const at = session.goTo({ nodeId: ids[1] as string, played: 1 });
      expect(at.renameMap('Z').cursor).toEqual(at.cursor);
      expect(at.flipOrientation().cursor).toEqual(at.cursor);
    });
  });

  describe('duplicating', () => {
    it('copies the active map as "<name> (copy)", switches to it, from its start', () => {
      const { session, ids } = e4e5();
      const s = session.renameMap('Open').goTo({ nodeId: ids[2] as string, played: 1 }).duplicateMap();
      expect(s.library.size).toBe(2);
      expect(s.repertoire.name).toBe('Open (copy)');
      expect(s.repertoire.id).not.toBe(session.repertoire.id);
      expect(s.repertoire.nodes()).toEqual(session.repertoire.nodes());
      expect(s.cursor).toEqual(s.repertoire.rootCursor());
      expect(types(s)).toEqual(['mapEntered']);
    });

    it('leaves the original untouched and editing the copy does not change it', () => {
      const { session } = e4e5();
      const s = session.duplicateMap();
      const original = s.library.ids()[0] as string;
      const edited = s.annotate(s.repertoire.rootId, 'only in the copy');
      expect(edited.library.get(original).node(s.repertoire.rootId).note).toBeUndefined();
    });
  });

  describe('deleting', () => {
    const three = () => {
      const base = editSession(emptyRep('A')).createMap('B', 'white').createMap('C', 'white');
      return { base, ids: base.library.ids() as [string, string, string] };
    };

    it('never deletes the last map', () => {
      const s = editSession();
      expect(s.deleteMap()).toBe(s);
      expect(s.deleteMap(s.library.activeId)).toBe(s);
    });

    it('deleting the active map activates the first remaining one, from its start, emitting mapEntered', () => {
      const { base, ids } = three();
      expect(base.library.activeId).toBe(ids[2]);
      const s = base.deleteMap();
      expect(s.library.has(ids[2])).toBe(false);
      expect(s.library.activeId).toBe(ids[0]);
      expect(s.cursor).toEqual(s.repertoire.rootCursor());
      expect(s.events).toEqual([{ type: 'mapEntered', mapId: ids[0] }]);
    });

    it('deleting another map keeps the active one but re-enters it from its start', () => {
      const { base, ids } = three();
      const deep = place(base, 'e4');
      const at = deep.goTo({ nodeId: lastChildId(deep, rootOf(deep)), played: 1 });
      const s = at.deleteMap(ids[0]);
      expect(s.library.activeId).toBe(ids[2]);
      expect(s.library.has(ids[0])).toBe(false);
      expect(s.cursor).toEqual(s.repertoire.rootCursor());
      expect(types(s)).toEqual(['mapEntered']);
    });

    it('an unknown map is refused', () => {
      const { base } = three();
      expect(base.deleteMap('ghost')).toBe(base);
    });

    it('the remaining maps keep their data', () => {
      const { base, ids } = three();
      const s = base.deleteMap(ids[1]);
      expect(s.library.get(ids[0]).data).toBe(base.library.get(ids[0]).data);
    });
  });

  describe('remembering the view', () => {
    it('saves the viewport on the active map, without events', () => {
      const s = editSession().rememberView({ center: [1, 2], zoom: 3 });
      expect(s.repertoire.view).toEqual({ center: [1, 2], zoom: 3 });
      expect(s.events).toEqual([]);
    });

    it('is never blocked by a flow and keeps the cursor and flow', () => {
      const s = editSession().play('e4', [O]).rememberView({ center: [1, 2], zoom: 3 });
      expect(s.placing).not.toBeNull();
      expect(s.repertoire.view?.zoom).toBe(3);
    });
  });
});

describe('events belong to the action that produced them', () => {
  it('a following action replaces the previous events', () => {
    const { session, ids } = e4e5();
    const a = session.goTo({ nodeId: ids[1] as string, played: 1 });
    expect(types(a)).toEqual(['focused']);
    expect(a.toggleRecording().events).toEqual([]);
    expect(a.annotate(ids[1] as string, 'n').events).toEqual([]);
  });

  it('a refused action returns the very same session, hence the same events', () => {
    const busy = editSession().play('e4', [O]);
    expect(busy.back()).toBe(busy);
    expect(busy.back().events).toBe(busy.events);
  });

  it('refused actions never carry events of their own', () => {
    const s = editSession();
    for (const refused of [s.back(), s.takeBack(), s.cancelPlacing(), s.confirmPlacing(), s.endRelocating(), s.switchMap('ghost'), s.deleteMap(), s.addMaps([])]) {
      expect(refused).toBe(s);
      expect(refused.events).toEqual([]);
    }
  });
});

describe('immutability', () => {
  it('no action changes the session or the data it was called on', () => {
    const { session, ids } = e4e5();
    const edit = session.goTo({ nodeId: ids[1] as string, played: 1 });
    const snapshot = JSON.stringify([edit.library.data, edit.cursor, edit.mode, edit.recording, edit.placing, edit.relocating]);
    const dataBefore = edit.library.data;
    const actions = [
      edit.play('c5', [O]), edit.play('e5'), edit.toggleRecording(), edit.toggleMode(), edit.back(), edit.forward(),
      place(edit, 'c5'), edit.annotate(ids[1] as string, 'x'), edit.resizeBoard(ids[1] as string, 1),
      edit.relocate(ids[1] as string, [9, 9], { withBranch: true }), edit.nameLocation(ids[1] as string, { label: 'P' }),
      edit.deletePosition(ids[2] as string), edit.createMap('N', 'black'), edit.duplicateMap(), edit.renameMap('R'),
      edit.flipOrientation(), edit.startRelocating(ids[1] as string), edit.rememberView({ center: [1, 1], zoom: 1 }),
    ];
    expect(actions).toHaveLength(18);
    expect(edit.library.data).toBe(dataBefore);
    expect(JSON.stringify([edit.library.data, edit.cursor, edit.mode, edit.recording, edit.placing, edit.relocating])).toBe(snapshot);
  });

  it('a spawned child does not leak into earlier sessions', () => {
    const before = editSession();
    const after = place(before, 'e4');
    expect(before.repertoire.nodes()).toHaveLength(1);
    expect(after.repertoire.nodes()).toHaveLength(2);
  });
});

describe('full scenarios', () => {
  it('a user builds a small repertoire, then trains on it', () => {
    let s = editSession();
    s = place(s, 'e4', [10, 20]);
    s = s.goTo({ nodeId: lastChildId(s, rootOf(s)), played: 1 });
    s = place(s, 'e5', [11, 21]).play('c5', [[12, 22]]).confirmPlacing();
    expect(children(s, s.cursor.nodeId)).toEqual(['e5', 'c5']);
    s = s.switchMode('explore').goTo(s.repertoire.rootCursor());
    expect(types(s.play('d4'))).toEqual(['rejected']);
    const followed = s.play('e4').play('c5');
    expect(followed.repertoire.sanPath(followed.cursor)).toEqual(['e4', 'c5']);
    expect(types(followed.forward())).toEqual(['deadEnd']);
    expect(followed.back().back().cursor).toEqual(s.repertoire.rootCursor());
  });

  it('record a whole line, branch off in the middle, and take the branch back', () => {
    const rec = editSession().toggleRecording();
    let s = rec;
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) s = s.play(san, [[1, 1], [2, 2]]);
    const id = s.cursor.nodeId;
    expect(s.repertoire.node(id).moves).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    s = s.goTo({ nodeId: id, played: 2 }).play('f4', [[8, 8], [9, 9]]);
    const branchId = s.cursor.nodeId;
    expect(s.repertoire.sanPath(s.cursor)).toEqual(['e4', 'e5', 'f4']);
    s = s.play('exf4');
    expect(s.repertoire.node(branchId).moves).toEqual(['f4', 'exf4']);
    expect(s.canTakeBack).toBe(true);
    expect(s.takeBack().repertoire.node(branchId).moves).toEqual(['f4']);
    // the split-off tail still holds the main line
    const tail = s.repertoire.node(id).children[0] as string;
    expect(s.repertoire.sanPath(s.repertoire.endOf(tail))).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('spawn helper agrees with the user flow', () => {
    const start = editSession();
    const r = spawn(start, start.repertoire.rootId, 'e4', [1, 1]);
    expect(r.session.repertoire.node(r.id).moves).toEqual(['e4']);
  });
});

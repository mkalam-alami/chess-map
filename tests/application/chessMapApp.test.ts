import { describe, expect, it, vi } from 'vitest';
import { ImportError } from '../../src/application';
import { Library, Repertoire, epd, type LngLat, type NodeId } from '../../src/domain';
import { emptyRep, libraryOf, treeOf } from '../domain/fixtures';
import { makeApp, settle } from './fakes';

const spots: LngLat[] = [[10, 10], [20, 20]];
const NAMED = { label: 'Paris', country: 'France' };

/** A stored library with moves (e4 e5 / d4) and a named root, so starting it triggers no geocoding. */
function storedLibrary(): Library {
  const { session } = treeOf({ e4: { e5: {} }, d4: {} });
  return libraryOf(session.nameLocation(session.repertoire.rootId, NAMED).repertoire);
}

/** An app started on `storedLibrary()` (Explore unless a mode preference is given), with the writes of starting cleared. */
function started(mode: 'explore' | 'edit' | null = null) {
  const t = makeApp();
  t.library.stored = storedLibrary();
  t.preferences.mode = mode;
  void t.app.start();
  return t;
}

const root = (t: ReturnType<typeof makeApp>): NodeId => t.app.session.repertoire.rootId;
/** The child markers of the root, in creation order. */
const kids = (t: ReturnType<typeof makeApp>): NodeId[] => t.app.session.repertoire.node(root(t)).children;
/** Edit mode: plays `san`, drops the marker at `at`, and returns its node id. */
function spawn(t: ReturnType<typeof makeApp>, san: string, at: LngLat = spots[0] as LngLat): NodeId {
  t.app.play(san, [at, spots[1] as LngLat]);
  t.app.confirmPlacing();
  const rep = t.app.session.repertoire;
  return rep.node(rep.rootId).children.find((c) => rep.node(c).plies[0] === san) as NodeId;
}
const placeOf = (t: ReturnType<typeof makeApp>, id: NodeId) => t.app.session.repertoire.node(id).place;

describe('start', () => {
  it('opens the stored library, in Explore by default', () => {
    const t = started();
    expect(t.app.session.library).toBe(t.library.stored);
    expect(t.app.session.mode).toBe('explore');
    expect(t.library.saved).toEqual([]);
  });

  it('opens the initial library when nothing is stored: one empty map, in Edit', () => {
    const t = makeApp();
    void t.app.start();
    expect(t.app.session.library.size).toBe(1);
    expect(t.app.session.repertoire.name).toBe('My repertoire');
    expect(t.app.session.mode).toBe('edit');
    expect(t.library.saved).toEqual([]); // nothing to persist yet
  });

  it('applies the saved mode preference to a map that has moves', () => {
    expect(started('edit').app.session.mode).toBe('edit');
    expect(started('explore').app.session.mode).toBe('explore');
  });

  it('an empty repertoire is opened in Edit whatever the preference, and the preference is kept', () => {
    const t = makeApp();
    t.library.stored = libraryOf(emptyRep('Empty'));
    t.preferences.mode = 'explore';
    void t.app.start();
    expect(t.app.session.mode).toBe('edit');
    expect(t.preferences.saved).toEqual([]);
  });

  it('reverse-geocodes the root when it has no place, and names it', async () => {
    const t = makeApp();
    void t.app.start();
    const rootNode = t.app.session.repertoire.node(root(t));
    expect(t.geocoder.calls).toHaveLength(1);
    expect(t.geocoder.calls[0]?.at).toEqual(rootNode.lngLat);
    t.geocoder.calls[0]?.resolve(NAMED);
    await settle();
    expect(placeOf(t, root(t))).toEqual(NAMED);
    expect(t.library.saved).toHaveLength(1);
  });

  it('does not geocode a root that is already named', () => {
    const t = started();
    expect(t.geocoder.calls).toEqual([]);
  });

  it('loads the opening book in the background and notifies subscribers when it is ready', async () => {
    const t = makeApp();
    t.library.stored = storedLibrary();
    const fn = vi.fn();
    t.app.subscribe(fn);
    const ready = t.app.start();
    const before = fn.mock.calls.length;
    t.openings.finishLoading();
    await ready;
    expect(t.openings.loads).toBe(1);
    expect(fn.mock.calls.length).toBe(before + 1);
  });

  it('survives an opening book that fails to load', async () => {
    const t = makeApp();
    t.library.stored = storedLibrary();
    const ready = t.app.start();
    t.openings.failLoading();
    await expect(ready).resolves.toBeUndefined();
    expect(t.app.openingAt()).toBeNull();
  });
});

describe('persistence', () => {
  it('saves the library when an action changed it, once, with the new library', () => {
    const t = started('edit');
    t.app.annotate(root(t), 'Start here');
    expect(t.library.saved).toEqual([t.app.session.library]);
  });

  it.each<[string, (t: ReturnType<typeof started>) => void]>([
    ['goTo', (t) => t.app.goTo(t.app.session.repertoire.endOf(kids(t)[0] as NodeId))],
    ['forward', (t) => t.app.forward()],
    ['forward at a dead end', (t) => { t.app.forward(); t.app.forward(); t.app.forward(); }],
    ['back at the start', (t) => t.app.back()],
    ['switchMode', (t) => t.app.switchMode('edit')],
    ['toggleRecording', (t) => t.app.toggleRecording()],
    ['startRelocating', (t) => { t.app.switchMode('edit'); t.app.startRelocating(root(t)); }],
    ['an Explore move that is rejected', (t) => t.app.play('a3')],
    ['an Explore move that is followed', (t) => t.app.play('e4')],
  ])('pure navigation does not save: %s', (_, act) => {
    const t = started();
    act(t);
    expect(t.library.saved).toEqual([]);
  });

  it('a refused action neither saves nor notifies', () => {
    const t = started('edit');
    const fn = vi.fn();
    t.app.subscribe(fn);
    t.app.deletePosition(root(t)); // never the root
    t.app.confirmPlacing(); // nothing to place
    expect(t.library.saved).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it.each<[string, (t: ReturnType<typeof started>) => void]>([
    ['annotate', (t) => t.app.annotate(root(t), 'n')],
    ['resizeBoard', (t) => t.app.resizeBoard(kids(t)[0] as NodeId, 1)],
    ['deletePosition', (t) => t.app.deletePosition(kids(t)[0] as NodeId)],
    ['relocate', (t) => t.app.relocate(root(t), [3, 4], { place: NAMED })],
    ['createMap', (t) => t.app.createMap('Second', 'black')],
    ['renameMap', (t) => t.app.renameMap('Renamed')],
    ['flipOrientation', (t) => t.app.flipOrientation()],
    ['duplicateMap', (t) => t.app.duplicateMap()],
    ['a confirmed placing', (t) => { t.app.play('c4', spots); t.app.confirmPlacing(); }],
  ])('saves after %s', (_, act) => {
    const t = started('edit');
    act(t);
    expect(t.library.saved.length).toBeGreaterThanOrEqual(1);
    expect(t.library.saved.at(-1)).toBe(t.app.session.library);
  });

  it('switching maps saves, because the active map is part of the library', () => {
    const t = started();
    const first = t.app.session.library.activeId;
    t.app.createMap('Second', 'white');
    const saves = t.library.saved.length;
    t.app.switchMap(first);
    expect(t.library.saved).toHaveLength(saves + 1);
    expect(t.library.saved.at(-1)?.activeId).toBe(first);
  });

  it('rememberView saves the library without notifying subscribers', () => {
    const t = started();
    const fn = vi.fn();
    t.app.subscribe(fn);
    t.app.rememberView({ center: [1, 2], zoom: 4 });
    expect(t.library.saved).toHaveLength(1);
    expect(t.app.session.repertoire.view).toEqual({ center: [1, 2], zoom: 4 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('flush asks the repository to write now', () => {
    const t = started();
    t.app.flush();
    expect(t.library.flushes).toBe(1);
  });
});

describe('mode preference', () => {
  it('saves the mode when the user switches', () => {
    const t = started('explore');
    t.app.switchMode('edit');
    t.app.switchMode('explore');
    expect(t.preferences.saved).toEqual(['edit', 'explore']);
  });

  it('toggleMode saves the new mode', () => {
    const t = started('explore');
    t.app.toggleMode();
    expect(t.preferences.saved).toEqual(['edit']);
  });

  it('does not save when the mode does not change', () => {
    const t = started('explore');
    t.app.switchMode('explore');
    expect(t.preferences.saved).toEqual([]);
  });

  it('does not save when the switch is refused while a move is being placed', () => {
    const t = started('edit');
    t.app.play('c4', spots);
    t.app.switchMode('explore');
    expect(t.app.session.mode).toBe('edit');
    expect(t.preferences.saved).toEqual([]);
  });

  it('a new empty map forces Edit but does not overwrite the saved preference', () => {
    const t = started('explore');
    t.app.createMap('Empty', 'white');
    expect(t.app.session.mode).toBe('edit');
    expect(t.preferences.saved).toEqual([]);
  });

  it('switching to an empty map does not overwrite the preference either, and the user can still choose', () => {
    const t = started('explore');
    const first = t.app.session.library.activeId;
    t.app.createMap('Empty', 'white');
    t.app.switchMap(first);
    expect(t.app.session.mode).toBe('edit'); // the mode carries over: explicit switch needed
    t.app.switchMode('explore');
    expect(t.preferences.saved).toEqual(['explore']);
  });
});

describe('subscriptions and events', () => {
  it('notifies subscribers after every change, until they unsubscribe', () => {
    const t = started('edit');
    const fn = vi.fn();
    const off = t.app.subscribe(fn);
    t.app.annotate(root(t), 'a');
    t.app.toggleRecording();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    t.app.toggleRecording();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('subscribers see the new session', () => {
    const t = started('edit');
    let seen = '';
    t.app.subscribe(() => { seen = t.app.session.repertoire.node(root(t)).note ?? ''; });
    t.app.annotate(root(t), 'visible');
    expect(seen).toBe('visible');
  });

  it('forwards focused events with the cursor and keepSize', () => {
    const t = started();
    const focused = vi.fn();
    t.app.on('focused', focused);
    t.app.forward();
    expect(focused).toHaveBeenCalledTimes(1);
    expect(focused).toHaveBeenCalledWith({ type: 'focused', cursor: t.app.session.cursor, keepSize: true });
    t.app.goTo(t.app.session.repertoire.rootCursor());
    expect(focused).toHaveBeenLastCalledWith({ type: 'focused', cursor: t.app.session.repertoire.rootCursor(), keepSize: false });
  });

  it('forwards deadEnd, and forward() reports whether it went anywhere', () => {
    const t = started();
    const dead = vi.fn();
    t.app.on('deadEnd', dead);
    expect(t.app.forward()).toBe(true); // e4 (the last child)... or d4
    while (t.app.forward());
    expect(dead).toHaveBeenCalledTimes(1);
  });

  it('forwards rejected moves, and play() reports them', () => {
    const t = started();
    const rejected = vi.fn();
    t.app.on('rejected', rejected);
    expect(t.app.play('a3')).toBe(false);
    expect(rejected).toHaveBeenCalledWith({ type: 'rejected', san: 'a3' });
    expect(t.app.play('e4')).toBe(true);
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('forwards mapEntered when a map is created, switched to or deleted', () => {
    const t = started();
    const entered = vi.fn();
    t.app.on('mapEntered', entered);
    const first = t.app.session.library.activeId;
    t.app.createMap('Second', 'black');
    const second = t.app.session.library.activeId;
    expect(entered).toHaveBeenLastCalledWith({ type: 'mapEntered', mapId: second });
    t.app.switchMap(first);
    expect(entered).toHaveBeenLastCalledWith({ type: 'mapEntered', mapId: first });
    t.app.duplicateMap();
    expect(entered).toHaveBeenCalledTimes(3);
    expect(t.app.deleteMap()).toBe(true);
    expect(entered).toHaveBeenCalledTimes(4);
  });

  it('event listeners run before subscribers, and can be removed', () => {
    const t = started();
    const order: string[] = [];
    const off = t.app.on('focused', () => order.push('event'));
    t.app.subscribe(() => order.push('subscriber'));
    t.app.forward();
    expect(order).toEqual(['event', 'subscriber']);
    off();
    t.app.back();
    expect(order).toEqual(['event', 'subscriber', 'subscriber']);
  });

  it('listeners are per event type', () => {
    const t = started();
    const dead = vi.fn();
    t.app.on('deadEnd', dead);
    t.app.forward();
    expect(dead).not.toHaveBeenCalled();
  });

  it('deleteMap refuses the last map', () => {
    const t = started();
    expect(t.app.deleteMap()).toBe(false);
    expect(t.app.session.library.size).toBe(1);
  });
});

describe('placing', () => {
  it('movePlacing notifies only placing subscribers, saves nothing and moves the ghost', () => {
    const t = started('edit');
    t.app.play('c4', spots);
    const all = vi.fn();
    const placing = vi.fn();
    t.app.subscribe(all);
    t.app.subscribePlacing(placing);
    t.app.movePlacing([30, 30]);
    expect(placing).toHaveBeenCalledTimes(1);
    expect(all).not.toHaveBeenCalled();
    expect(t.app.session.placing?.lngLat).toEqual([30, 30]);
    expect(t.library.saved).toEqual([]);
  });

  it('movePlacing without a move being placed tells nobody', () => {
    const t = started('edit');
    const placing = vi.fn();
    t.app.subscribePlacing(placing);
    t.app.movePlacing([1, 1]);
    expect(placing).not.toHaveBeenCalled();
  });

  it('entering and leaving placing notify normal subscribers, not the placing channel', () => {
    const t = started('edit');
    const all = vi.fn();
    const placing = vi.fn();
    t.app.subscribe(all);
    t.app.subscribePlacing(placing);
    t.app.play('c4', spots);
    t.app.cancelPlacing();
    expect(all).toHaveBeenCalledTimes(2);
    expect(placing).not.toHaveBeenCalled();
  });

  it('a placing subscriber can unsubscribe', () => {
    const t = started('edit');
    t.app.play('c4', spots);
    const placing = vi.fn();
    t.app.subscribePlacing(placing)();
    t.app.movePlacing([1, 1]);
    expect(placing).not.toHaveBeenCalled();
  });

  it('confirming creates the marker where the ghost was dropped', () => {
    const t = started('edit');
    const id = (t.app.play('c4', spots), t.app.movePlacing([33, 44]), t.app.confirmPlacing(), kids(t).at(-1) as NodeId);
    expect(t.app.session.repertoire.node(id)).toMatchObject({ plies: ['c4'], lngLat: [33, 44] });
  });
});

describe('reverse geocoding', () => {
  it('names a new marker from the geocoder, with the coordinates that were requested', async () => {
    const t = started('edit');
    const id = spawn(t, 'c4', [12, 34]);
    expect(t.geocoder.calls).toHaveLength(1);
    expect(t.geocoder.calls[0]?.at).toEqual([12, 34]);
    t.geocoder.calls[0]?.resolve({ label: 'Lisbon, Portugal', country: 'Portugal' });
    await settle();
    expect(placeOf(t, id)).toEqual({ label: 'Lisbon, Portugal', country: 'Portugal' });
  });

  it('saves the name and notifies subscribers', async () => {
    const t = started('edit');
    spawn(t, 'c4');
    const saves = t.library.saved.length;
    const fn = vi.fn();
    t.app.subscribe(fn);
    t.geocoder.calls[0]?.resolve(NAMED);
    await settle();
    expect(t.library.saved).toHaveLength(saves + 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses 'Open sea' when there is nothing at the position", async () => {
    const t = started('edit');
    const id = spawn(t, 'c4');
    t.geocoder.calls[0]?.resolve(null);
    await settle();
    expect(placeOf(t, id)).toEqual({ label: 'Open sea' });
  });

  it('relocating a marker without a place looks it up again, at the wrapped position', async () => {
    const t = started('edit');
    const id = spawn(t, 'c4');
    t.app.relocate(id, [190, 10]);
    expect(t.geocoder.calls[1]?.at).toEqual([-170, 10]);
    t.geocoder.calls[1]?.resolve(NAMED);
    await settle();
    expect(placeOf(t, id)).toEqual(NAMED);
  });

  it('the latest lookup per node wins: the previous one is aborted and its result ignored', async () => {
    const t = started('edit');
    const id = spawn(t, 'c4');
    t.app.relocate(id, [50, 20]);
    const [first, second] = t.geocoder.calls;
    expect(first?.signal.aborted).toBe(true);
    expect(second?.signal.aborted).toBe(false);
    first?.resolve({ label: 'Old' }); // a fake that ignores the abort and answers anyway
    await settle();
    expect(placeOf(t, id)).toBeUndefined();
    second?.resolve({ label: 'New' });
    await settle();
    expect(placeOf(t, id)).toEqual({ label: 'New' });
  });

  it('an aborted lookup that rejects is not an error', async () => {
    const t = started('edit');
    const id = spawn(t, 'c4');
    t.app.relocate(id, [50, 20]);
    t.geocoder.calls[0]?.reject(new DOMException('Aborted', 'AbortError'));
    t.geocoder.calls[1]?.resolve({ label: 'New' });
    await settle();
    expect(placeOf(t, id)).toEqual({ label: 'New' });
  });

  it('lookups for different nodes do not cancel each other', async () => {
    const t = started('edit');
    const a = spawn(t, 'c4', [1, 1]);
    const b = spawn(t, 'Nf3', [2, 2]);
    expect(t.geocoder.calls.map((c) => c.signal.aborted)).toEqual([false, false]);
    t.geocoder.calls[1]?.resolve({ label: 'B' });
    t.geocoder.calls[0]?.resolve({ label: 'A' });
    await settle();
    expect([placeOf(t, a)?.label, placeOf(t, b)?.label]).toEqual(['A', 'B']);
  });

  it('is ignored when the node was moved with an explicit place in the meantime', async () => {
    const t = started('edit');
    const id = spawn(t, 'c4', [1, 1]);
    t.app.relocate(id, [60, 30], { place: { label: 'Chosen' } });
    expect(t.geocoder.calls).toHaveLength(1); // an explicit place needs no lookup
    t.geocoder.calls[0]?.resolve({ label: 'Stale' });
    await settle();
    expect(placeOf(t, id)).toEqual({ label: 'Chosen' });
  });

  it('is ignored when the node was deleted in the meantime', async () => {
    const t = started('edit');
    const id = spawn(t, 'c4');
    t.app.deletePosition(id);
    const saves = t.library.saved.length;
    const fn = vi.fn();
    t.app.subscribe(fn);
    t.geocoder.calls[0]?.resolve(NAMED);
    await settle();
    expect(t.app.session.repertoire.hasNode(id)).toBe(false);
    expect(t.library.saved).toHaveLength(saves);
    expect(fn).not.toHaveBeenCalled();
  });

  it('is ignored when another map is active (the node is not in it)', async () => {
    const t = started('edit');
    const id = spawn(t, 'c4');
    t.app.createMap('Other', 'white');
    t.geocoder.calls[0]?.resolve(NAMED);
    await settle();
    expect(t.app.session.library.active.hasNode(id)).toBe(false);
  });

  it('a failed lookup leaves the place empty, without error, and later lookups still work', async () => {
    const t = started('edit');
    const id = spawn(t, 'c4');
    const saves = t.library.saved.length;
    t.geocoder.calls[0]?.reject(new Error('HTTP 429'));
    await settle();
    expect(placeOf(t, id)).toBeUndefined();
    expect(t.library.saved).toHaveLength(saves);
    t.app.relocate(id, [5, 5]);
    t.geocoder.calls[1]?.resolve(NAMED);
    await settle();
    expect(placeOf(t, id)).toEqual(NAMED);
  });

  it('recording a first move spawns a marker and names it too', async () => {
    const t = started('edit');
    t.app.toggleRecording();
    t.app.play('c4', spots);
    expect(t.geocoder.calls).toHaveLength(1);
    t.geocoder.calls[0]?.resolve(NAMED);
    await settle();
    expect(placeOf(t, t.app.session.cursor.nodeId)).toEqual(NAMED);
  });
});

describe('import', () => {
  const ctx = { name: 'games.pgn', origin: [5, 6] as LngLat };
  const maps = (...names: string[]) => names.map((n) => Repertoire.create(n, 'white', [0, 0]));

  it('adds the maps, switches to the last one and returns how many there were', () => {
    const t = started();
    const [a, b] = maps('A', 'B') as [Repertoire, Repertoire];
    t.pgn.result = [a, b];
    expect(t.app.importMaps('pgn', 'TEXT', ctx)).toBe(2);
    expect(t.app.session.library.size).toBe(3);
    expect(t.app.session.library.activeId).toBe(b.id);
    expect(t.library.saved.at(-1)).toBe(t.app.session.library);
  });

  it('hands the text and the context to the chosen format only', () => {
    const t = started();
    t.json.result = maps('J');
    t.app.importMaps('json', '{"x":1}', ctx);
    expect(t.json.reads).toEqual([{ text: '{"x":1}', ctx }]);
    expect(t.pgn.reads).toEqual([]);
  });

  it('announces the entered map and notifies subscribers', () => {
    const t = started();
    const entered = vi.fn();
    const fn = vi.fn();
    t.app.on('mapEntered', entered);
    t.app.subscribe(fn);
    const [a] = maps('A') as [Repertoire];
    t.pgn.result = [a];
    t.app.importMaps('pgn', 'TEXT', ctx);
    expect(entered).toHaveBeenCalledWith({ type: 'mapEntered', mapId: a.id });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('an imported empty map opens in Edit without touching the mode preference', () => {
    const t = started('explore');
    t.pgn.result = maps('A');
    t.app.importMaps('pgn', 'TEXT', ctx);
    expect(t.app.session.mode).toBe('edit');
    expect(t.preferences.saved).toEqual([]);
  });

  it('an ImportError propagates and leaves everything untouched', () => {
    const t = started();
    const before = t.app.session;
    const fn = vi.fn();
    t.app.subscribe(fn);
    t.pgn.result = new ImportError('Game 1: illegal move "Ke3" at move 2.');
    expect(() => t.app.importMaps('pgn', 'TEXT', ctx)).toThrow('Game 1: illegal move "Ke3" at move 2.');
    expect(t.app.session).toBe(before);
    expect(t.library.saved).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a format that finds no map changes nothing', () => {
    const t = started();
    const before = t.app.session;
    t.pgn.result = [];
    expect(t.app.importMaps('pgn', '', ctx)).toBe(0);
    expect(t.app.session).toBe(before);
  });
});

describe('export', () => {
  it('saves the active map through the file saver with the format\'s extension and mime type', () => {
    const t = started();
    t.app.renameMap('My Opening');
    t.pgn.output = '1. e4 *';
    t.app.exportMap('pgn');
    expect(t.files.saved).toEqual([{ filename: 'My Opening.pgn', content: '1. e4 *', mimeType: 'application/x-chess-pgn' }]);
    expect(t.pgn.written).toEqual([t.app.session.repertoire]);
  });

  it('works for every format', () => {
    const t = started();
    t.json.output = '{}';
    t.app.exportMap('json');
    expect(t.files.saved[0]).toMatchObject({ filename: `${t.app.session.repertoire.name}.chessmap.json`, content: '{}', mimeType: 'application/json' });
    expect(t.pgn.written).toEqual([]);
  });

  it('exports the map that is active now', () => {
    const t = started();
    t.app.createMap('Second', 'black');
    t.app.exportMap('json');
    expect(t.files.saved[0]?.filename).toBe('Second.chessmap.json');
  });

  it('does not change the session', () => {
    const t = started();
    const before = t.app.session;
    t.app.exportMap('pgn');
    expect(t.app.session).toBe(before);
    expect(t.library.saved).toEqual([]);
  });
});

describe('analysis', () => {
  it('opens the active map at the cursor and returns the outcome', async () => {
    const t = started();
    t.app.forward();
    const result = t.app.openInAnalysis();
    expect(t.analysis.opened).toHaveLength(1);
    expect(t.analysis.opened[0]?.map).toBe(t.app.session.repertoire);
    expect(t.analysis.opened[0]?.cursor).toEqual(t.app.session.cursor);
    t.analysis.opened[0]?.result.resolve('opened');
    await expect(result).resolves.toBe('opened');
  });

  it("passes on 'copied' when the PGN went to the clipboard", async () => {
    const t = started();
    const result = t.app.openInAnalysis();
    t.analysis.opened[0]?.result.resolve('copied');
    await expect(result).resolves.toBe('copied');
  });

  it('rejects when the analysis board fails (clipboard)', async () => {
    const t = started();
    const result = t.app.openInAnalysis();
    t.analysis.opened[0]?.result.reject(new Error('clipboard denied'));
    await expect(result).rejects.toThrow('clipboard denied');
  });
});

describe('opening names', () => {
  it('are null until the book is loaded, then named, and subscribers are told', async () => {
    const t = started();
    const rep = t.app.session.repertoire;
    const e4 = rep.endOf(kids(t)[0] as NodeId);
    t.openings.names.set(epd(rep.fenAt(e4)), { eco: 'B00', name: "King's Pawn" });
    const fn = vi.fn();
    t.app.subscribe(fn);
    expect(t.app.openingAt(e4)).toBeNull();
    t.openings.finishLoading();
    await settle();
    expect(t.app.openingAt(e4)).toMatchObject({ eco: 'B00', name: "King's Pawn", exact: true, pliesSince: 0 });
    expect(fn).toHaveBeenCalled();
  });

  it('defaults to the current cursor, and reports plies since the last named position', async () => {
    const t = started();
    const rep = t.app.session.repertoire;
    t.openings.names.set(epd(rep.fenAt(rep.endOf(kids(t)[0] as NodeId))), { eco: 'B00', name: "King's Pawn" });
    t.openings.finishLoading();
    await settle();
    expect(t.app.openingAt()).toBeNull(); // the start position is not named
    t.app.goTo(rep.endOf(kids(t)[0] as NodeId));
    expect(t.app.openingAt()?.exact).toBe(true);
    t.app.forward(); // e5: out of the (fake) book
    expect(t.app.openingAt()).toMatchObject({ name: "King's Pawn", exact: false, pliesSince: 1 });
  });
});

describe('place search', () => {
  it('delegates to the port with the query and the abort signal', async () => {
    const t = started();
    t.placeSearch.hits = [{ label: 'Lisbon, Portugal', lngLat: [-9.1, 38.7] }];
    const ac = new AbortController();
    await expect(t.app.searchPlaces('Lis', ac.signal)).resolves.toEqual(t.placeSearch.hits);
    expect(t.placeSearch.queries).toEqual([{ query: 'Lis', signal: ac.signal }]);
  });
});

import maplibregl from 'maplibre-gl';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { fenAt, inCheck, legalDests, moveSquares, promotionColor, sanPath, tryMove, turnColor } from '../chess/replay';
import { cursorBack } from '../model/cursor';
import { getNode, type Cursor, type LngLat } from '../model/types';
import { NOMINAL_PX, effectiveBoardZoom } from '../model/scale';
import { activeMap, beginPlacing, beginRelocate, closeBoard, exploreMove, getState, hooks, moveExists, moveNodeTo, playMove, subscribe } from '../store/store';
import { wrapNear } from '../geo/lngLat';
import { confirmDeleteNode } from '../ui/confirmDelete';
import { el, iconButton, shieldFromMap } from '../ui/dom';
import { askPromotion } from '../ui/promotion';
import { toast } from '../ui/toast';
import { createBoardSizer } from './boardSize';
import { makeDraggable } from './drag';
import { clearPreview, onOverride, overrides, previewMove } from './live';
import { createNoteEditor } from './noteEditor';
import { spawnAngles } from './spawn';

export function createBoardMarker(map: maplibregl.Map): { update: () => void } {
  const cursorId = (): string => getState().cursor.nodeId;
  const note = createNoteEditor();
  const trash = iconButton('trash', 'board-delete', 'Delete this position (Del)', 'size-btn');
  trash.addEventListener('click', () => void confirmDeleteNode(cursorId()));
  const locate = iconButton('mapPin', 'board-locate', 'Set location by city (L)', 'size-btn locate-btn');
  locate.addEventListener('click', () => beginRelocate(cursorId()));
  const closeBtn = iconButton('close', 'board-close', 'Close the board', 'size-btn');
  closeBtn.addEventListener('click', closeBoard);
  const lichess = iconButton('external', 'board-lichess', 'Open this line in Lichess', 'size-btn');
  lichess.addEventListener('click', () => hooks.menu['open-lichess']?.());

  // Equal-width side groups keep the grip hint centred whatever icons are shown.
  const left = el('div', 'handle-side');
  const right = el('div', 'handle-side right');
  left.append(note.toggle, locate, lichess);
  right.append(trash, closeBtn);
  const handle = el('div', 'board-handle');
  handle.append(left, el('span', 'grip', '⠇⠇⠇'), right);
  const wrap = el('div', 'board-wrap', '', { 'data-testid': 'board' });
  const grip = el('div', 'board-grip', '', { 'data-testid': 'board-grip', title: 'Drag to resize' });
  const card = el('div', 'board-card', '', { 'data-testid': 'board-card' });
  card.append(handle, wrap, grip);
  const root = el('div', 'board-root');
  root.append(card, note.box);
  shieldFromMap(root);

  const marker = new maplibregl.Marker({ element: root, anchor: 'center' }).setLngLat(getNode(activeMap(), cursorId()).lngLat).addTo(map);

  const cg: Api = Chessground(wrap, {
    coordinates: true,
    animation: { duration: 150 },
    highlight: { lastMove: true, check: true },
    premovable: { enabled: false },
    movable: { free: false, showDests: true, events: { after: (orig, dest) => onUserMove(orig, dest) } },
    draggable: { showGhost: true },
  });
  // The board moves with the map: chessground caches its bounds, so refresh them before it reads a pointer position.
  // Chessground reports user moves asynchronously (setTimeout 1ms) and has already flipped the turn / dropped the dests by then.
  // A pointer press in that gap would be ignored, so resync first.
  for (const ev of ['pointerdown', 'mousedown', 'touchstart']) {
    wrap.addEventListener(ev, () => {
      cg.state.dom.bounds.clear();
      const fen = fenAt(activeMap(), getState().cursor);
      const lm = cg.state.lastMove;
      if (cg.state.turnColor !== turnColor(fen) && lm) onUserMove(lm[0] as Key, lm[1] as Key); // run the not-yet-reported move now
      else if (cg.state.turnColor !== turnColor(fen) || !cg.state.movable.dests) update();
    }, true);
  }
  window.addEventListener('resize', () => cg.redrawAll());

  const sizer = createBoardSizer(map, card, grip, () => cg.redrawAll());

  const centerPoint = (): { x: number; y: number } => {
    const r = card.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  makeDraggable({
    map,
    handle,
    enabled: () => getState().mode === 'edit' && !getState().placing,
    anchorPoint: centerPoint,
    onPreview: (ll, subtree) => previewMove(activeMap(), cursorId(), ll, subtree),
    onDrop: (ll, subtree) => {
      clearPreview();
      moveNodeTo(cursorId(), ll, subtree);
    },
    onCancel: clearPreview,
  });
  onOverride(() => marker.setLngLat(overrides.get(cursorId()) ?? getNode(activeMap(), cursorId()).lngLat));

  /** Map positions around the board for new markers, away from the existing children and on screen. */
  function spawnSpots(count: number): LngLat[] {
    const m = activeMap();
    const node = getNode(m, cursorId());
    const c = centerPoint();
    const rect = map.getContainer().getBoundingClientRect();
    const cx = c.x - rect.left;
    const cy = c.y - rect.top;
    const boardLng = map.unproject([cx, cy]).lng;
    const taken = node.children.map((id) => {
      const ll = getNode(m, id).lngLat;
      const p = map.project([wrapNear(ll[0], boardLng), ll[1]]);
      return Math.atan2(p.y - cy, p.x - cx);
    });
    // World-relative: 0.9 board widths at the board's own (unclamped) scale, independent of the current zoom.
    const r = 0.9 * NOMINAL_PX * 2 ** (map.getZoom() - effectiveBoardZoom(m, node.id));
    const at = (a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const onScreen = (a: number): boolean => {
      const [x, y] = at(a);
      return x >= 40 && y >= 60 && x <= rect.width - 40 && y <= rect.height - 20;
    };
    return spawnAngles(taken, count, onScreen).map((a) => {
      const ll = map.unproject(at(a));
      return [ll.lng, ll.lat];
    });
  }

  let handled = '';
  function onUserMove(orig: Key, dest: Key): void {
    const { cursor, mode } = getState();
    const fen = fenAt(activeMap(), cursor);
    // Chessground's deferred report of a move we already processed (see the pointerdown guard) is ignored.
    const key = orig + dest + fen;
    if (key === handled) return;
    handled = key;
    setTimeout(() => (handled = ''), 20);
    const color = promotionColor(fen, orig, dest);
    if (color) {
      askPromotion(wrap, color, (p) => (p ? commitMove(mode, tryMove(fen, { from: orig, to: dest, promotion: p })?.san) : update()));
      return;
    }
    commitMove(mode, tryMove(fen, { from: orig, to: dest })?.san);
  }

  function commitMove(mode: 'explore' | 'edit', san: string | undefined): void {
    if (!san) {
      update();
    } else if (mode === 'explore') {
      if (!exploreMove(san)) {
        update(); // snap back
        toast('Not in repertoire');
      }
    } else {
      const spots = spawnSpots(2);
      if (!getState().pin && !moveExists(san)) beginPlacing(san, spots[0] as LngLat, spots[1]);
      else playMove(san, spots);
    }
  }

  function lastMoveOf(cursor: Cursor): [Key, Key] | undefined {
    const m = activeMap();
    const prev = cursorBack(m, cursor);
    const san = sanPath(m, cursor).at(-1);
    return prev && san ? moveSquares(fenAt(m, prev), san) : undefined;
  }

  function update(): void {
    const s = getState();
    const m = activeMap();
    const node = getNode(m, s.cursor.nodeId);
    const fen = fenAt(m, s.cursor);
    const turn = turnColor(fen);
    marker.setLngLat(overrides.get(node.id) ?? node.lngLat);
    wrap.dataset.fen = fen;
    card.dataset.mode = s.mode;
    note.update(node, s.mode === 'edit');
    trash.style.visibility = node.parentId === null ? 'hidden' : '';
    root.style.display = s.boardOpen ? '' : 'none';
    card.classList.toggle('placing', !!s.placing);
    card.classList.toggle('relocating', s.relocating?.nodeId === node.id);
    handle.title = s.mode === 'edit' ? 'Drag to move the board' : '';
    cg.set({
      fen,
      orientation: m.orientation,
      turnColor: turn,
      viewOnly: !!s.placing,
      check: inCheck(fen),
      lastMove: lastMoveOf(s.cursor),
      movable: { color: turn, dests: legalDests(fen) as Map<Key, Key[]> },
    });
    sizer.apply();
  }

  update();
  subscribe(update);
  return { update };
}

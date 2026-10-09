import maplibregl from 'maplibre-gl';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Chess, type Square } from 'chess.js';
import { fenAt, legalDests, sanPath, tryMove, turnColor } from '../chess/replay';
import { cursorBack } from '../model/cursor';
import { getNode, type Cursor, type LngLat } from '../model/types';
import { NOMINAL_PX, boardPx, effectiveBoardZoom, gripResize } from '../model/scale';
import { activeMap, beginPlacing, closeBoard, hooks, setNote, exploreMove, getState, moveExists, moveNodeTo, beginRelocate, playMove, setBoardSize } from '../store/store';
import { button, el, shieldFromMap } from '../ui/dom';
import { icon } from '../ui/icons';
import { toast } from '../ui/toast';
import { makeDraggable } from './drag';
import { confirmDeleteNode } from './pinMarker';
import { clearPreview, onOverride, overrides, previewMove } from './live';
import { isMobile, padding, wrapNear } from './mapView';

const FAN_STEPS = 24;
const angDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};

export function createBoardMarker(map: maplibregl.Map): { update: () => void } {
  const card = el('div', 'board-card', '', { 'data-testid': 'board-card' });
  const handle = el('div', 'board-handle');
  let noteEditing = false;
  let noteNode = getState().cursor.nodeId;
  const noteBtn = button('', 'board-note', 'size-btn');
  noteBtn.append(icon('note', 14));
  noteBtn.title = 'Edit the note';
  const trash = button('', 'board-delete', 'size-btn');
  trash.append(icon('trash', 14));
  trash.title = 'Delete this position (Del)';
  trash.addEventListener('click', () => void confirmDeleteNode(getState().cursor.nodeId));
  const locate = button('', 'board-locate', 'size-btn locate-btn');
  locate.append(icon('mapPin', 14));
  locate.title = 'Set location by city (L)';
  locate.addEventListener('click', () => beginRelocate(getState().cursor.nodeId));
  const closeBtn = button('', 'board-close', 'size-btn');
  closeBtn.append(icon('close', 14));
  closeBtn.title = 'Close the board';
  closeBtn.addEventListener('click', closeBoard);
  const lichess = button('', 'board-lichess', 'size-btn');
  lichess.append(icon('external', 14));
  lichess.title = 'Open this line in Lichess';
  lichess.addEventListener('click', () => hooks.menu['open-lichess']?.());
  // Equal-width side groups keep the grip hint centred whatever icons are shown.
  const left = el('div', 'handle-side');
  const right = el('div', 'handle-side right');
  left.append(noteBtn, locate, lichess);
  right.append(trash, closeBtn);
  handle.append(left, el('span', 'grip', '⠇⠇⠇'), right);
  const wrap = el('div', 'board-wrap', '', { 'data-testid': 'board' });
  const grip = el('div', 'board-grip', '', { 'data-testid': 'board-grip', title: 'Drag to resize' });
  card.append(handle, wrap, grip);

  // The note sits below the board, outside the card (which clips) and out of flow, so the board stays centred on its position.
  const noteBox = el('div', 'board-note-box');
  const noteText = el('div', 'board-note-text', '', { 'data-testid': 'note-text' });
  const noteInput = el('textarea', 'board-note-input', '', { rows: '3', placeholder: 'Note…', 'data-testid': 'note-input' });
  const noteSpan = el('span');
  const notePencil = button('', 'note-edit', 'note-pencil');
  notePencil.append(icon('edit', 12));
  notePencil.title = 'Edit the note';
  noteText.append(noteSpan, notePencil);
  noteBox.append(noteText, noteInput);
  const root = el('div', 'board-root');
  root.append(card, noteBox);
  shieldFromMap(root);
  const setEditing = (on: boolean): void => {
    noteEditing = on;
    update();
    if (on) noteInput.focus();
  };
  noteBtn.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus, so the toggle is not preceded by a blur that closes it
  noteBtn.addEventListener('click', () => setEditing(!noteEditing));
  notePencil.addEventListener('click', () => setEditing(true));
  // MapLibre handles presses in the capture phase and cancels their default (caret placement, text selection), so keep them away from it.
  for (const t of ['mousedown', 'pointerdown', 'touchstart', 'dblclick']) {
    document.addEventListener(t, (e) => {
      if (e.target instanceof Node && noteBox.contains(e.target)) e.stopPropagation();
    }, true);
  }
  // Map and board swallow mousedown (no blur), so also close on any press outside the note.
  document.addEventListener('pointerdown', (e) => {
    if (noteEditing && e.target instanceof Node && !noteBox.contains(e.target) && !noteBtn.contains(e.target)) setEditing(false);
  }, true);
  noteInput.addEventListener('blur', () => {
    if (noteEditing) setEditing(false);
  });
  noteInput.addEventListener('input', () => setNote(getState().cursor.nodeId, noteInput.value));
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && !e.isComposing)) {
      e.preventDefault(); // Enter closes the editor, Shift+Enter adds a line
      setEditing(false);
    }
  });

  const marker = new maplibregl.Marker({ element: root, anchor: 'center' }).setLngLat(getNode(activeMap(), getState().cursor.nodeId).lngLat).addTo(map);

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

  // ---- size: follows the map zoom, see model/scale ----
  let liveExtra = 0; // log2 growth while the resize grip is dragged
  let lastPx = 0;
  function applySize(): void {
    const c = map.getContainer();
    const pad = padding();
    const view = { width: c.clientWidth, height: c.clientHeight - (pad.top ?? 0) - (pad.bottom ?? 0) };
    const zoom = effectiveBoardZoom(activeMap(), getState().cursor.nodeId) - liveExtra;
    const px = Math.round(boardPx(map.getZoom(), zoom, view, isMobile() ? 80 : 100));
    if (px === lastPx) return;
    lastPx = px;
    card.style.setProperty('--board-size', px + 'px');
    cg.redrawAll();
  }
  let sizeFrame = 0;
  const scheduleSize = (): void => {
    if (!sizeFrame) sizeFrame = requestAnimationFrame(() => ((sizeFrame = 0), applySize()));
  };
  map.on('zoom', scheduleSize);
  map.on('resize', scheduleSize);

  grip.addEventListener('pointerdown', (e) => {
    if (getState().mode !== 'edit' || e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const id = getState().cursor.nodeId;
    const start = { x: e.clientX, y: e.clientY, px: lastPx, z0: map.getZoom(), bz0: effectiveBoardZoom(activeMap(), id) };
    const move = (ev: PointerEvent): void => {
      const c = map.getContainer();
      const pad = padding();
      const maxPx = 0.9 * Math.min(c.clientWidth, c.clientHeight - (pad.top ?? 0) - (pad.bottom ?? 0));
      const r = gripResize({
        ...start,
        desiredPx: Math.max(20, start.px + (ev.clientX - start.x) + (ev.clientY - start.y)),
        minPx: isMobile() ? 80 : 100,
        maxPx,
        minZoom: map.getMinZoom(),
        maxZoom: map.getMaxZoom(),
      });
      liveExtra = r.extra;
      if (Math.abs(r.mapZoom - map.getZoom()) > 1e-9) zoomAroundBoard(r.mapZoom);
      applySize();
    };
    const end = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      const total = (getNode(activeMap(), id).sizeDelta ?? 0) + liveExtra;
      liveExtra = 0;
      setBoardSize(id, total); // snaps to 0.25 and commits once
      applySize();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });

  /** Sets the zoom while the board stays at the same place on screen. */
  function zoomAroundBoard(zoom: number): void {
    const id = getState().cursor.nodeId;
    const ll = getNode(activeMap(), id).lngLat;
    const at: [number, number] = [wrapNear(ll[0], map.getCenter().lng), ll[1]];
    const before = map.project(at);
    map.jumpTo({ zoom });
    const after = map.project(at);
    const cp = map.project(map.getCenter());
    const c = map.unproject([cp.x + after.x - before.x, cp.y + after.y - before.y]);
    map.jumpTo({ center: c });
  }

  const centerPoint = (): { x: number; y: number } => {
    const r = card.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  makeDraggable({
    map,
    handle,
    enabled: () => getState().mode === 'edit' && !getState().placing,
    anchorPoint: centerPoint,
    onPreview: (ll, subtree) => previewMove(activeMap(), getState().cursor.nodeId, ll, subtree),
    onDrop: (ll, subtree) => {
      clearPreview();
      moveNodeTo(getState().cursor.nodeId, ll, subtree);
    },
    onCancel: clearPreview,
  });
  onOverride(() => {
    const id = getState().cursor.nodeId;
    marker.setLngLat(overrides.get(id) ?? getNode(activeMap(), id).lngLat);
  });

  /** Screen offsets (px) around the board for new markers, avoiding existing children. */
  function spawnSpots(count: number): LngLat[] {
    const m = activeMap();
    const node = getNode(m, getState().cursor.nodeId);
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
    const out: LngLat[] = [];
    for (let i = 0; i < count; i++) {
      let best = -Math.PI / 4;
      let bestD = -1;
      for (let k = 0; k < FAN_STEPS; k++) {
        const a = -Math.PI / 4 + (k * 2 * Math.PI) / FAN_STEPS;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (px < 40 || py < 60 || px > rect.width - 40 || py > rect.height - 20) continue; // keep new pins on screen
        const d = taken.length ? Math.min(...taken.map((t) => angDist(a, t))) : Infinity;
        if (d > bestD + 1e-9) {
          bestD = d;
          best = a;
        }
      }
      taken.push(best);
      const ll = map.unproject([cx + r * Math.cos(best), cy + r * Math.sin(best)]);
      out.push([ll.lng, ll.lat]);
    }
    return out;
  }

  /** Small 4-piece chooser over the board; calls back with q/r/b/n, or null when dismissed. */
  function askPromotion(color: 'white' | 'black', done: (p: 'q' | 'r' | 'b' | 'n' | null) => void): void {
    const overlay = el('div', 'promo', '', { 'data-testid': 'promo' });
    const close = (p: 'q' | 'r' | 'b' | 'n' | null): void => {
      overlay.remove();
      done(p);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    for (const [role, letter] of [['queen', 'q'], ['rook', 'r'], ['bishop', 'b'], ['knight', 'n']] as const) {
      const b = el('button', 'promo-choice', '', { type: 'button', 'data-testid': 'promo-' + letter, 'aria-label': role });
      const piece = document.createElement('piece');
      piece.className = color + ' ' + role;
      b.append(piece);
      b.addEventListener('click', () => close(letter));
      overlay.append(b);
    }
    wrap.append(overlay);
  }

  let handled = '';
  function onUserMove(orig: Key, dest: Key): void {
    const s = getState();
    const fen = fenAt(activeMap(), s.cursor);
    // Chessground's deferred report of a move we already processed (see the pointerdown guard) is ignored.
    const key = orig + dest + fen;
    if (key === handled) return;
    handled = key;
    setTimeout(() => (handled = ''), 20);
    const piece = new Chess(fen).get(orig as Square);
    const promo = piece?.type === 'p' && (dest[1] === '1' || dest[1] === '8');
    if (promo && piece) {
      askPromotion(piece.color === 'w' ? 'white' : 'black', (p) => (p ? commitMove(s.mode, tryMove(fen, { from: orig, to: dest, promotion: p })?.san) : update()));
      return;
    }
    commitMove(s.mode, tryMove(fen, { from: orig, to: dest })?.san);
  }

  function commitMove(mode: 'explore' | 'edit', san: string | undefined): void {
    const r = san ? { san } : null;
    if (!r) {
      update();
      return;
    }
    if (mode === 'explore') {
      if (!exploreMove(r.san)) {
        update(); // snap back
        toast('Not in repertoire');
      }
    } else {
      const spots = spawnSpots(2);
      if (!getState().pin && !moveExists(r.san)) beginPlacing(r.san, spots[0] as LngLat, spots[1]);
      else playMove(r.san, spots);
    }
  }

  function lastMoveOf(cursor: Cursor): [Key, Key] | undefined {
    const m = activeMap();
    const prev = cursorBack(m, cursor);
    const san = sanPath(m, cursor).at(-1);
    if (!prev || !san || cursor.ply === 0) return undefined;
    try {
      const mv = new Chess(fenAt(m, prev)).move(san);
      return [mv.from, mv.to];
    } catch {
      return undefined;
    }
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
    if (node.id !== noteNode || s.mode !== 'edit') noteEditing = false;
    noteNode = node.id;
    const note = node.note ?? '';
    noteSpan.textContent = note;
    if (noteInput.value !== note) noteInput.value = note;
    noteInput.hidden = !noteEditing;
    noteText.hidden = noteEditing || !note;
    noteBox.hidden = noteInput.hidden && noteText.hidden;
    noteBtn.classList.toggle('active', noteEditing);
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
      check: new Chess(fen).inCheck(),
      lastMove: lastMoveOf(s.cursor),
      movable: { color: turn, dests: legalDests(fen) as Map<Key, Key[]> },
    });
    applySize();
  }

  update();
  applySize();
  return { update };
}

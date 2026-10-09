import maplibregl from 'maplibre-gl';
import { openingAt } from '../chess/openings';
import { moveLabel, sanPath } from '../chess/replay';
import { cursorEnd } from '../model/cursor';
import { pathTo, subtreeSize } from '../model/tree';
import { getNode, type ChessMap, type MapNode, type NodeId } from '../model/types';
import { activeMap, beginRelocate, deleteNode, focus, getState, moveNodeTo, setNote } from '../store/store';
import { button, el, shieldFromMap } from '../ui/dom';
import { icon } from '../ui/icons';
import { closePopover, confirmDialog, openPopover } from '../ui/popover';
import { makeDraggable } from './drag';
import { clearPreview, onOverride, overrides, previewMove } from './live';

type Kind = 'child' | 'ancestor' | 'root' | 'overview';
const TESTID: Record<Kind, string> = { child: 'pin', ancestor: 'pin-ancestor', root: 'pin-root', overview: 'pin-overview' };

interface Entry {
  marker: maplibregl.Marker;
  root: HTMLElement;
  label: HTMLElement;
  note: HTMLElement;
  kind: Kind;
}

/** `3.Nf3 … (+4)` for multi-ply segments; the start marker is a board icon. */
export function pinLabel(map: ChessMap, node: MapNode): string {
  if (node.parentId === null) return '♟';
  const start = sanPath(map, cursorEnd(map, node.parentId)).length;
  const first = moveLabel(start, node.plies[0] as string);
  return node.plies.length > 1 ? `${first} … (+${node.plies.length - 1})` : first;
}

export function createPinMarkers(map: maplibregl.Map): { update: () => void } {
  const entries = new Map<NodeId, Entry>();
  let lastPulse = getState().pulse;

  function desired(): Map<NodeId, Kind> {
    const s = getState();
    const m = activeMap();
    const node = getNode(m, s.cursor.nodeId);
    const out = new Map<NodeId, Kind>();
    if (s.overview) for (const id of Object.keys(m.nodes)) out.set(id, 'overview');
    for (const id of pathTo(m, node.id)) out.set(id, id === m.rootId ? 'root' : 'ancestor');
    if (s.cursor.ply === node.plies.length) for (const c of node.children) out.set(c, 'child');
    out.delete(node.id); // the board stands there
    return out;
  }

  function openFor(entry: Entry, id: NodeId): void {
    const m = activeMap();
    const node = getNode(m, id);
    if (entry.kind === 'ancestor' || entry.kind === 'root') {
      focus(cursorEnd(m, id));
      return;
    }
    openPopover(entry.root, (close) => {
      const editing = getState().mode === 'edit';
      const box = el('div', 'pin-popover');
      box.append(el('strong', '', pinLabel(m, node)));
      const op = openingAt(m, cursorEnd(m, id));
      if (op) box.append(el('div', `pop-opening muted${op.exact ? '' : ' inexact'}`, `${op.eco} · ${op.exact ? op.name : `${op.name} +${op.pliesSince}`}`, { 'data-testid': 'pop-opening' }));
      if (editing) {
        const loc = button('', 'pop-locate', 'pop-place');
        loc.append(icon('mapPin', 14), el('span', '', node.place?.label ?? 'Set location…'), icon('edit', 14));
        loc.title = 'Set location by city';
        loc.addEventListener('click', () => {
          close();
          beginRelocate(id);
        });
        box.append(loc);
      } else if (node.place?.label) box.append(el('div', 'muted', node.place.label));
      const note = el('textarea', '', '', { rows: '3', placeholder: editing ? 'Note…' : 'No note', 'data-testid': 'pop-note' });
      note.value = node.note ?? '';
      note.readOnly = !editing;
      if (editing || node.note) note.addEventListener('input', () => setNote(id, note.value));
      const row = el('div', 'dialog-actions');
      const enter = button('Enter ▸', 'pop-enter', 'primary');
      enter.addEventListener('click', () => {
        close();
        focus({ nodeId: id, ply: 1 });
      });
      row.append(enter);
      if (editing) {
        const del = button('Delete', 'pop-delete', 'danger');
        del.addEventListener('click', async () => {
          close();
          const n = subtreeSize(activeMap(), id);
          if (await confirmDialog(n > 1 ? `Delete this position and ${n - 1} below it?` : 'Delete this position?', 'Delete')) deleteNode(id);
        });
        row.append(del);
      }
      box.append(note, row);
      return box;
    });
  }

  function create(id: NodeId, kind: Kind): Entry {
    const root = el('div', 'pin');
    const label = el('span', 'pin-label');
    const note = el('span', 'pin-note', '✎');
    const enterBtn = button('▸', 'pin-enter', 'pin-enter');
    root.append(label, note, enterBtn);
    shieldFromMap(root);
    const marker = new maplibregl.Marker({ element: root, anchor: 'bottom' }).setLngLat([0, 0]).addTo(map);
    const entry: Entry = { marker, root, label, note, kind };
    const enter = (): void => focus(entry.kind === 'ancestor' || entry.kind === 'root' ? cursorEnd(activeMap(), id) : { nodeId: id, ply: 1 });
    enterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      enter();
    });
    // Single click opens the popover after a short delay so a double click can enter instead.
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    root.addEventListener('dblclick', () => {
      clearTimeout(clickTimer);
      closePopover();
      enter();
    });
    const dragged = makeDraggable({
      map,
      handle: root,
      longPress: true,
      enabled: () => getState().mode === 'edit' && !getState().placing && entry.kind !== 'root',
      anchorPoint: () => {
        const r = root.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.bottom };
      },
      onPreview: (ll, subtree) => previewMove(activeMap(), id, ll, subtree),
      onDrop: (ll, subtree) => {
        clearPreview();
        moveNodeTo(id, ll, subtree);
      },
      onCancel: clearPreview,
    });
    root.addEventListener('click', () => {
      if (dragged() || getState().placing) return;
      clearTimeout(clickTimer);
      if (entry.kind === 'ancestor' || entry.kind === 'root') openFor(entry, id);
      else clickTimer = setTimeout(() => openFor(entry, id), 250);
    });
    return entry;
  }

  function update(): void {
    const m = activeMap();
    const want = desired();
    for (const [id, entry] of entries) {
      if (!want.has(id)) {
        entry.marker.remove();
        entries.delete(id);
      }
    }
    const pulse = getState().pulse !== lastPulse;
    lastPulse = getState().pulse;
    const editing = getState().mode === 'edit';
    for (const [id, kind] of want) {
      const node = getNode(m, id);
      let e = entries.get(id);
      if (!e) {
        e = create(id, kind);
        entries.set(id, e);
      }
      e.kind = kind;
      e.marker.setLngLat(overrides.get(id) ?? node.lngLat);
      const text = pinLabel(m, node);
      e.label.textContent = text;
      e.note.hidden = !node.note;
      e.root.classList.remove('pin-child', 'pin-ancestor', 'pin-root', 'pin-overview');
      e.root.classList.add('pin', `pin-${kind}`);
      e.root.classList.toggle('editable', editing);
      e.root.classList.toggle('relocating', getState().relocating?.nodeId === id);
      e.root.dataset.testid = TESTID[kind];
      e.root.dataset.nodeId = id;
      e.root.dataset.label = text;
      const op = openingAt(m, cursorEnd(m, id));
      e.root.title = [op && `${op.eco} ${op.exact ? op.name : `${op.name} +${op.pliesSince}`}`, node.place?.label].filter(Boolean).join(' · ');
      if (pulse && kind === 'child') {
        e.root.classList.add('pulse');
        setTimeout(() => e.root.classList.remove('pulse'), 900);
      }
    }
  }

  onOverride(update);
  update();
  return { update };
}

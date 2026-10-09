import maplibregl from 'maplibre-gl';
import { openingAt, openingText } from '../chess/openings';
import type { NodeId } from '../domain';
import { activeRepertoire, focus, getState, moveNodeTo, subscribe } from '../store/store';
import { el, shieldFromMap } from '../ui/dom';
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

export function createPinMarkers(map: maplibregl.Map): { update: () => void } {
  const entries = new Map<NodeId, Entry>();
  let lastPulse = getState().pulse;

  function desired(): Map<NodeId, Kind> {
    const s = getState();
    const m = activeRepertoire();
    const node = m.node(s.cursor.nodeId);
    const out = new Map<NodeId, Kind>();
    if (s.overview) for (const n of m.nodes()) out.set(n.id, 'overview');
    for (const id of m.pathTo(node.id)) out.set(id, id === m.rootId ? 'root' : 'ancestor');
    if (s.cursor.ply === node.plies.length) for (const c of node.children) out.set(c, 'child');
    out.delete(node.id); // the board stands there
    if (!s.boardOpen) out.set(node.id, node.id === m.rootId ? 'root' : 'ancestor'); // closed: its pin is the way back
    return out;
  }

  function create(id: NodeId, kind: Kind): Entry {
    const root = el('div', 'pin');
    const label = el('span', 'pin-label');
    const note = el('span', 'pin-note', '✎');
    root.append(label, note);
    shieldFromMap(root);
    const marker = new maplibregl.Marker({ element: root, anchor: 'bottom' }).setLngLat([0, 0]).addTo(map);
    const entry: Entry = { marker, root, label, note, kind };
    const enter = (): void => {
      const { cursor } = getState();
      if (cursor.nodeId === id) focus(cursor); // the closed board's own pin: reopen where it was
      else focus(entry.kind === 'ancestor' || entry.kind === 'root' ? activeRepertoire().endOf(id) : { nodeId: id, ply: 1 });
    };
    const dragged = makeDraggable({
      map,
      handle: root,
      longPress: true,
      enabled: () => getState().mode === 'edit' && !getState().placing && entry.kind !== 'root',
      anchorPoint: () => {
        const r = root.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.bottom };
      },
      onPreview: (ll, subtree) => previewMove(activeRepertoire(), id, ll, subtree),
      onDrop: (ll, subtree) => {
        clearPreview();
        moveNodeTo(id, ll, subtree);
      },
      onCancel: clearPreview,
    });
    root.addEventListener('click', () => {
      if (dragged() || getState().placing) return;
      enter();
    });
    return entry;
  }

  function update(): void {
    const m = activeRepertoire();
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
    // Overview: the further from the cursor (in markers), the smaller the pin.
    const dist = getState().overview ? m.distancesFrom(getState().cursor.nodeId) : null;
    for (const [id, kind] of want) {
      const node = m.node(id);
      let e = entries.get(id);
      if (!e) {
        e = create(id, kind);
        entries.set(id, e);
      }
      e.kind = kind;
      e.marker.setLngLat(overrides.get(id) ?? node.lngLat);
      const text = m.pinLabel(id);
      e.label.textContent = text;
      e.note.hidden = !node.note;
      e.root.classList.remove('pin-child', 'pin-ancestor', 'pin-root', 'pin-overview');
      e.root.classList.add('pin', `pin-${kind}`);
      const d = dist?.get(id) ?? 0;
      e.root.classList.toggle('pin-black', m.firstPlyIndex(id) % 2 === 1); // played by Black
      e.root.classList.toggle('pin-d2', d === 3 || d === 4);
      e.root.classList.toggle('pin-d5', d >= 5);
      e.root.classList.toggle('editable', editing);
      e.root.classList.toggle('relocating', getState().relocating?.nodeId === id);
      e.root.dataset.testid = TESTID[kind];
      e.root.dataset.nodeId = id;
      e.root.dataset.label = text;
      const op = openingAt(m, m.endOf(id));
      e.root.title = [op && `${op.eco} ${openingText(op)}`, node.place?.label].filter(Boolean).join(' · ');
      if (pulse && kind === 'child') {
        e.root.classList.add('pulse');
        setTimeout(() => e.root.classList.remove('pulse'), 900);
      }
    }
  }

  onOverride(update);
  subscribe(update);
  update();
  return { update };
}

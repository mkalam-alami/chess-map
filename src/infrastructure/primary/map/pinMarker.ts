import maplibregl from 'maplibre-gl';
import { openingText, type NodeId } from '../../../domain';
import type { ChessMapApp } from '../../../application';
import type { ViewState } from '../viewState';
import { el, shieldFromMap } from '../ui/dom';
import { makeDraggable } from './drag';
import type { DragPreview } from './dragPreview';

type Kind = 'child' | 'ancestor' | 'root' | 'overview';
const TESTID: Record<Kind, string> = { child: 'pin', ancestor: 'pin-ancestor', root: 'pin-root', overview: 'pin-overview' };

interface Entry {
  marker: maplibregl.Marker;
  root: HTMLElement;
  label: HTMLElement;
  note: HTMLElement;
  noteBox: HTMLElement;
  kind: Kind;
}

export function createPinMarkers(map: maplibregl.Map, app: ChessMapApp, vs: ViewState, preview: DragPreview): { update: () => void } {
  const entries = new Map<NodeId, Entry>();
  let lastPulse = vs.pulse;

  function desired(): Map<NodeId, Kind> {
    const s = app.session;
    const m = s.repertoire;
    const node = m.node(s.cursor.nodeId);
    const out = new Map<NodeId, Kind>();
    if (vs.overview) for (const n of m.nodes()) out.set(n.id, 'overview');
    if (vs.overview && !vs.boardOpen) return out.set(m.rootId, 'root'); // no board: the last cursor highlights nothing, every pin keeps its default look
    for (const id of m.pathTo(node.id)) out.set(id, id === m.rootId ? 'root' : 'ancestor');
    if (s.cursor.played === node.moves.length) for (const c of node.children) out.set(c, 'child');
    // Notes pinned by the user are landmarks: shown (faded like the overview) whatever the overview toggle says.
    for (const n of m.nodes()) if (n.noteShown && n.note && !out.has(n.id)) out.set(n.id, 'overview');
    out.delete(node.id); // the board stands there
    if (!vs.boardOpen) out.set(node.id, node.id === m.rootId ? 'root' : 'ancestor'); // closed: its pin is the way back
    return out;
  }

  function create(id: NodeId, kind: Kind): Entry {
    const root = el('div', 'pin');
    const label = el('span', 'pin-label');
    const note = el('span', 'pin-note', '✎');
    const noteBox = el('div', 'pin-notebox', '', { 'data-testid': 'pin-notebox' });
    root.append(label, note, noteBox);
    shieldFromMap(root);
    const marker = new maplibregl.Marker({ element: root, anchor: 'bottom' }).setLngLat([0, 0]).addTo(map);
    const entry: Entry = { marker, root, label, note, noteBox, kind };
    const enter = (): void => {
      const { cursor, repertoire } = app.session;
      if (cursor.nodeId === id) app.goTo(cursor); // the closed board's own pin: reopen where it was
      else app.goTo(entry.kind === 'ancestor' || entry.kind === 'root' ? repertoire.endOf(id) : { nodeId: id, played: 1 });
    };
    const dragged = makeDraggable({
      map,
      handle: root,
      longPress: true,
      enabled: () => app.session.mode === 'edit' && !app.session.placing && entry.kind !== 'root',
      anchorPoint: () => {
        const r = root.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.bottom };
      },
      onPreview: (ll, subtree) => preview.previewMove(app.session.repertoire, id, ll, subtree),
      onDrop: (ll, subtree) => {
        preview.clear();
        app.relocate(id, ll, { withBranch: subtree });
      },
      onCancel: preview.clear,
    });
    root.addEventListener('click', () => {
      if (dragged() || app.session.placing) return;
      enter();
    });
    return entry;
  }

  function update(): void {
    const m = app.session.repertoire;
    const want = desired();
    for (const [id, entry] of entries) {
      if (!want.has(id)) {
        entry.marker.remove();
        entries.delete(id);
      }
    }
    const pulse = vs.pulse !== lastPulse;
    lastPulse = vs.pulse;
    const editing = app.session.mode === 'edit';
    // Overview: the further from the cursor (in markers), the smaller the pin.
    const dist = vs.overview && vs.boardOpen ? m.distancesFrom(app.session.cursor.nodeId) : null;
    const farthest = vs.overview && !vs.boardOpen; // nothing to measure from: all pins in the most distant state
    const shown = (n: { noteShown?: boolean; note?: string }): boolean => !!n.noteShown && !!n.note;
    for (const [id, kind] of want) {
      const node = m.node(id);
      let e = entries.get(id);
      if (!e) {
        e = create(id, kind);
        entries.set(id, e);
      }
      e.kind = kind;
      e.marker.setLngLat(preview.overrides.get(id) ?? node.lngLat);
      const text = m.pinLabel(id);
      e.label.textContent = text;
      e.note.hidden = !node.note || shown(node); // the shown note replaces the pencil hint
      e.noteBox.hidden = !shown(node);
      e.noteBox.textContent = shown(node) ? (node.note as string) : '';
      e.root.classList.remove('pin-child', 'pin-ancestor', 'pin-root', 'pin-overview');
      e.root.classList.add('pin', `pin-${kind}`);
      const d = farthest ? (kind === 'root' ? 0 : 5) : dist?.get(id) ?? 0; // the start marker keeps its icon
      e.root.classList.toggle('pin-black', m.firstMoveIndex(id) % 2 === 1); // played by Black
      e.root.classList.toggle('pin-d2', d === 3 || d === 4);
      e.root.classList.toggle('pin-d5', d >= 5);
      e.root.classList.toggle('editable', editing);
      e.root.classList.toggle('relocating', app.session.relocating?.nodeId === id);
      e.root.dataset.testid = TESTID[kind];
      e.root.dataset.nodeId = id;
      e.root.dataset.label = text;
      const op = app.openingAt(m.endOf(id));
      e.root.title = [op && `${op.eco} ${openingText(op)}`, node.place?.label].filter(Boolean).join(' · ');
      if (pulse && kind === 'child') {
        e.root.classList.add('pulse');
        setTimeout(() => e.root.classList.remove('pulse'), 900);
      }
    }
  }

  preview.onChange(update);
  vs.subscribe(update);
  update();
  return { update };
}

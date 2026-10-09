import type { MapNodeData } from '../domain';
import { getState, setNote } from '../store/store';
import { el, iconButton } from '../ui/dom';

export interface NoteEditor {
  /** Goes under the board, outside the card (which clips) and out of flow, so the board stays centred on its position. */
  box: HTMLElement;
  /** Header toggle. */
  toggle: HTMLButtonElement;
  update: (node: MapNodeData, editable: boolean) => void;
}

/** The board's note: shown below it, edited in place (Enter / Escape / outside press close, Shift+Enter adds a line). */
export function createNoteEditor(): NoteEditor {
  const toggle = iconButton('note', 'board-note', 'Edit the note', 'size-btn');
  const box = el('div', 'board-note-box');
  const text = el('div', 'board-note-text', '', { 'data-testid': 'note-text' });
  const input = el('textarea', 'board-note-input', '', { rows: '3', placeholder: 'Note…', 'data-testid': 'note-input' });
  const span = el('span');
  const pencil = iconButton('edit', 'note-edit', 'Edit the note', 'note-pencil', 12);
  text.append(span, pencil);
  box.append(text, input);

  let editing = false;
  let editable = false;
  let nodeId: string | undefined;
  let note = '';

  function render(): void {
    span.textContent = note;
    if (input.value !== note) input.value = note;
    input.hidden = !editing;
    text.hidden = editing || !note;
    box.hidden = input.hidden && text.hidden;
    toggle.classList.toggle('active', editing);
  }

  const setEditing = (on: boolean): void => {
    editing = on && editable;
    render();
    if (editing) input.focus();
  };

  toggle.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus, so the toggle is not preceded by a blur that closes it
  toggle.addEventListener('click', () => setEditing(!editing));
  pencil.addEventListener('click', () => setEditing(true));
  // MapLibre handles presses in the capture phase and cancels their default (caret placement, text selection), so keep them away from it.
  for (const t of ['mousedown', 'pointerdown', 'touchstart', 'dblclick']) {
    document.addEventListener(t, (e) => {
      if (e.target instanceof Node && box.contains(e.target)) e.stopPropagation();
    }, true);
  }
  // Map and board swallow mousedown (no blur), so also close on any press outside the note.
  document.addEventListener('pointerdown', (e) => {
    if (editing && e.target instanceof Node && !box.contains(e.target) && !toggle.contains(e.target)) setEditing(false);
  }, true);
  input.addEventListener('blur', () => {
    if (editing) setEditing(false);
  });
  input.addEventListener('input', () => setNote(getState().cursor.nodeId, input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && !e.isComposing)) {
      e.preventDefault(); // Enter closes the editor, Shift+Enter adds a line
      setEditing(false);
    }
  });

  function update(node: MapNodeData, canEdit: boolean): void {
    if (node.id !== nodeId || !canEdit) editing = false;
    nodeId = node.id;
    editable = canEdit;
    note = node.note ?? '';
    render();
  }

  return { box, toggle, update };
}

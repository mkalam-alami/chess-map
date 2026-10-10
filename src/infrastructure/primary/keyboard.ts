import type { ChessMapApp } from '../../application';
import type { ViewState } from './viewState';
import { isTyping } from './ui/dom';
import { confirmDeleteNode } from './ui/confirmDelete';

/** Keyboard shortcuts (listed in the README). Ignored while typing, in a dialog, or while a transient flow owns the input. */
export function installKeyboard(app: ChessMapApp, vs: ViewState): void {
  window.addEventListener('keydown', (e) => {
    if (app.session.busy || isTyping(e.target) || e.altKey || document.querySelector('dialog[open]')) return;
    const edit = app.session.mode === 'edit' && vs.boardOpen; // board tools need a visible board
    const key = e.key.toLowerCase();
    const plain = !e.ctrlKey && !e.metaKey;
    if (e.key === 'ArrowLeft') app.back();
    else if (e.key === 'ArrowRight') app.forward();
    else if (plain && key === 'e') app.toggleMode();
    else if (plain && key === 'p' && edit) app.toggleRecording();
    else if (plain && key === 'l' && edit) app.startRelocating(app.session.cursor.nodeId);
    else if (edit && e.key === 'Delete') void confirmDeleteNode(app, app.session.cursor.nodeId);
    else if (edit && ((key === 'z' && !plain) || e.key === 'Backspace')) {
      if (app.session.canTakeBack) app.takeBack();
    } else return;
    e.preventDefault();
  });
}

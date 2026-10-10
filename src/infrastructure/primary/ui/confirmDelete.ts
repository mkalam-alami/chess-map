import type { ChessMapApp } from '../../../application';
import type { NodeId } from '../../../domain';
import { confirmDialog } from './overlay';

/** Asks for confirmation (with the number of positions that go with it), then deletes the node and its subtree. Never the root. */
export async function confirmDeleteNode(app: ChessMapApp, id: NodeId): Promise<void> {
  const rep = app.session.repertoire;
  if (rep.node(id).parentId === null) return;
  const n = rep.branchSize(id);
  if (await confirmDialog(n > 1 ? `Delete this position and ${n - 1} below it?` : 'Delete this position?', 'Delete')) app.deletePosition(id);
}

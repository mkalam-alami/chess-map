import type { NodeId } from '../domain';
import { activeRepertoire, deleteNode } from '../store/store';
import { confirmDialog } from './overlay';

/** Asks for confirmation (with the number of positions that go with it), then deletes the node and its subtree. Never the root. */
export async function confirmDeleteNode(id: NodeId): Promise<void> {
  const rep = activeRepertoire();
  if (rep.node(id).parentId === null) return;
  const n = rep.branchSize(id);
  if (await confirmDialog(n > 1 ? `Delete this position and ${n - 1} below it?` : 'Delete this position?', 'Delete')) deleteNode(id);
}

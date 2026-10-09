import { subtreeSize } from '../model/tree';
import { getNode, type NodeId } from '../model/types';
import { activeMap, deleteNode } from '../store/store';
import { confirmDialog } from './overlay';

/** Asks for confirmation (with the number of positions that go with it), then deletes the node and its subtree. Never the root. */
export async function confirmDeleteNode(id: NodeId): Promise<void> {
  if (getNode(activeMap(), id).parentId === null) return;
  const n = subtreeSize(activeMap(), id);
  if (await confirmDialog(n > 1 ? `Delete this position and ${n - 1} below it?` : 'Delete this position?', 'Delete')) deleteNode(id);
}

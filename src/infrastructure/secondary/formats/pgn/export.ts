import { Repertoire, formatLine, type ChessMapData, type Cursor, type MapNodeData, type NodeId } from '../../../../domain';

export interface ExportOptions {
  /**
   * Full export: only the path root -> cursor is kept (no sibling branches on
   * it); everything below the cursor's node is included.
   * With `lineOnly`: the cursor to stop at (default: follow the mainline to its end).
   */
  fromCursor?: Cursor;
  /** Just the SAN line, no headers/comments/variations. */
  lineOnly?: boolean;
}

/** Escapes characters that cannot appear raw inside a quoted command argument or a PGN comment. */
export const escapeArg = (s: string): string => s.replace(/[%"\\{}[\]]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
export const unescapeArg = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const sanitizeNote = (s: string): string => s.trim().replace(/\}/g, ')').replace(/\[%/g, '[ %');
const tagValue = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const coord = (n: number): string => String(Number(n.toFixed(5)));

function headCommands(node: MapNodeData): string[] {
  const cmds = [`[%geo ${coord(node.lngLat[1])},${coord(node.lngLat[0])}]`];
  if (node.sizeDelta) cmds.push(`[%size ${node.sizeDelta}]`);
  if (node.pinned) cmds.push('[%pinned 1]');
  else if (node.plies.length > 1) cmds.push('[%pinned 0]'); // unpinned multi-ply segment: keep it merged on re-import
  if (node.place) {
    cmds.push(`[%place "${escapeArg(node.place.label)}"]`);
    if (node.place.country) cmds.push(`[%country "${escapeArg(node.place.country)}"]`);
  }
  return cmds;
}

const comment = (parts: string[]): string => `{${parts.join(' ')}}`;

function mainlineCursor(rep: Repertoire): Cursor {
  let node = rep.node(rep.rootId);
  while (node.children.length) node = rep.node(node.children[0] as NodeId);
  return { nodeId: node.id, ply: node.plies.length };
}

export function exportPgn(map: ChessMapData, opts: ExportOptions = {}): string {
  const rep = Repertoire.fromData(map);
  if (opts.lineOnly) {
    const cursor = opts.fromCursor ?? mainlineCursor(rep);
    return formatLine(rep.sanPath(cursor));
  }

  // Nodes on the path root -> cursor: only their path child is expanded.
  const onPath = new Map<NodeId, NodeId | null>(); // node -> next path node (null at the cursor node)
  if (opts.fromCursor) {
    let id: NodeId | null = opts.fromCursor.nodeId;
    let next: NodeId | null = null;
    while (id !== null) {
      onPath.set(id, next);
      next = id;
      id = rep.node(id).parentId;
    }
  }
  const childrenOf = (node: MapNodeData): NodeId[] => {
    if (!onPath.has(node.id)) return node.children;
    const next = onPath.get(node.id);
    return next ? [next] : node.children;
  };

  const out: string[] = [];
  let needNum = true;

  /** Emits `id` (all its plies), its alternatives at the first ply, then its subtree. */
  const writeLine = (ids: NodeId[], startPly: number): void => {
    const [first, ...alts] = ids as [NodeId, ...NodeId[]];
    const node = rep.node(first);
    let ply = startPly;
    node.plies.forEach((san, i) => {
      if (ply % 2 === 0) out.push(`${ply / 2 + 1}.`);
      else if (needNum) out.push(`${(ply - 1) / 2 + 1}...`);
      needNum = false;
      out.push(san);
      const last = i === node.plies.length - 1;
      const parts = i === 0 ? headCommands(node) : [];
      if (last && node.note?.trim()) parts.push(sanitizeNote(node.note));
      if (parts.length) {
        out.push(comment(parts));
        needNum = true;
      }
      if (i === 0) {
        for (const alt of alts) {
          const at = out.length;
          needNum = true;
          writeLine([alt], startPly);
          out[at] = '(' + out[at];
          out[out.length - 1] += ')';
          needNum = true;
        }
      }
      ply++;
    });
    const kids = childrenOf(node);
    if (kids.length) writeLine(kids, ply);
  };

  const root = rep.node(rep.rootId);
  const rootParts = headCommands(root);
  if (root.note?.trim()) rootParts.push(sanitizeNote(root.note));
  out.push(comment(rootParts));
  const rootKids = childrenOf(root);
  if (rootKids.length) writeLine(rootKids, 0);
  out.push('*');

  const headers = [
    ['Event', map.name],
    ['Site', 'Chess Map'],
    ['Result', '*'],
    ['Orientation', map.orientation],
    ...(map.boardZoom !== undefined ? [['BoardZoom', String(map.boardZoom)]] : []),
  ];
  const head = headers.map(([k, v]) => `[${k} "${tagValue(v as string)}"]`).join('\n');
  return `${head}\n\n${out.join(' ')}\n`;
}


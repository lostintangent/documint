// Canonical structural path builders used by document normalization and
// traversal. Paths are not stored on nodes; they are deterministic coordinates
// derived from the node's position in the semantic tree.

export function rootBlockPath(rootIndex: number) {
  return indexedPath("root", rootIndex);
}

export function indexedPath(parentPath: string, childIndex: number) {
  return `${parentPath}.${childIndex}`;
}

export function childContainerPath(parentPath: string) {
  return `${parentPath}.children`;
}

export function sourcePath(parentPath: string) {
  return `${parentPath}.source`;
}

export function childBlockPath(parentPath: string, childIndex: number) {
  return indexedPath(childContainerPath(parentPath), childIndex);
}

export function inlineChildPath(containerPath: string, childIndex: number) {
  return childBlockPath(containerPath, childIndex);
}

export function inlinePath(inlineContainerPath: string, childIndex: number) {
  return indexedPath(inlineContainerPath, childIndex);
}

export function tableRowPath(tablePath: string, rowIndex: number) {
  return `${tablePath}.rows.${rowIndex}`;
}

export function tableCellPath(rowPath: string, cellIndex: number) {
  return `${rowPath}.cells.${cellIndex}`;
}

export function tableCellInlineChildPath(cellPath: string, childIndex: number) {
  return inlinePath(childContainerPath(cellPath), childIndex);
}

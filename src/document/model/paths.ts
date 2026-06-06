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

export function tableRowPath(tablePath: string, rowIndex: number) {
  return `${tablePath}.rows.${rowIndex}`;
}

export function tableCellPath(rowPath: string, cellIndex: number) {
  return `${rowPath}.cells.${cellIndex}`;
}

// Inverse of `childBlockPath` for an entire descent chain. Walks a path
// like `root.1.children.2.children.0` and yields the `[2, 0]` sequence of
// child indices that traverse from the root block down to the addressed
// descendant. Non-`children` segments (e.g. `.rows.2.cells.1`, `.source`)
// are ignored — the function returns the descent through structural
// container blocks only, mirroring `childBlockPath`'s composition rule.
export function parseBlockChildIndices(path: string): number[] {
  const segments = path.split(".");
  const indices: number[] = [];

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === "children") {
      const childIndex = Number(segments[index + 1]);

      if (Number.isInteger(childIndex)) {
        indices.push(childIndex);
      }
    }
  }

  return indices;
}

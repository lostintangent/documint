// Canonical structural path builders used by document traversal, indexing, and
// anchors. Paths are not stored on nodes; they are deterministic coordinates
// derived from the node's position in the semantic tree.

type TableCellPathContext = {
  cellIndex: number;
  rowIndex: number;
  tablePath: string;
};

type BlockPathCoordinates = {
  childIndices: number[];
  rootIndex: number;
  siblingIndex: number;
};

export function rootBlockPath(rootIndex: number) {
  return indexedPath("root", rootIndex);
}

export function indexedPath(parentPath: string, childIndex: number) {
  return `${parentPath}.${childIndex}`;
}

export function childContainerPath(parentPath: string) {
  return `${parentPath}.children`;
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

export function isBlockPath(path: string) {
  return blockPathCoordinates(path) !== null;
}

export function blockPathFromCoordinates(rootIndex: number, childIndices: readonly number[] = []) {
  if (!isValidPathIndex(rootIndex) || childIndices.some((index) => !isValidPathIndex(index))) {
    return null;
  }

  return childIndices.reduce(childBlockPath, rootBlockPath(rootIndex));
}

export function blockPathWithRootIndex(path: string, rootIndex: number) {
  const blockPath = blockPathCoordinates(path);

  return blockPath ? blockPathFromCoordinates(rootIndex, blockPath.childIndices) : null;
}

// The same position under another root, for block and table cell paths.
export function pathWithRootIndex(path: string, rootIndex: number) {
  const cell = tableCellPathContextFromPath(path);

  if (!cell) {
    return blockPathWithRootIndex(path, rootIndex);
  }

  const tablePath = blockPathWithRootIndex(cell.tablePath, rootIndex);

  return tablePath && tableCellPath(tableRowPath(tablePath, cell.rowIndex), cell.cellIndex);
}

export function blockPathSiblingIndex(path: string) {
  return blockPathCoordinates(path)?.siblingIndex ?? null;
}

export function parentBlockPath(path: string) {
  const blockPath = blockPathCoordinates(path);

  if (!blockPath) {
    return tableCellPathContextFromPath(path)?.tablePath ?? null;
  }

  if (blockPath.childIndices.length === 0) {
    return null;
  }

  const parentChildIndices = blockPath.childIndices.slice(0, -1);
  return blockPathFromCoordinates(blockPath.rootIndex, parentChildIndices);
}

export function rootIndexForPath(path: string) {
  const [prefix, rootIndexSegment] = path.split(".", 2);

  if (prefix !== "root" || rootIndexSegment === undefined) {
    return null;
  }

  return pathIndexFromSegment(rootIndexSegment);
}

export function blockPathCoordinates(path: string): BlockPathCoordinates | null {
  const segments = path.split(".");
  if (segments[0] !== "root" || segments.length < 2) {
    return null;
  }

  const rootIndex = pathIndexFromSegment(segments[1]);
  if (rootIndex === null) {
    return null;
  }

  const childIndices: number[] = [];

  for (let index = 2; index < segments.length; index += 2) {
    if (segments[index] !== "children") {
      return null;
    }

    const childIndex = pathIndexFromSegment(segments[index + 1]);
    if (childIndex === null) {
      return null;
    }

    childIndices.push(childIndex);
  }

  return {
    childIndices,
    rootIndex,
    siblingIndex: childIndices.at(-1) ?? rootIndex,
  };
}

const tableCellPathPattern = /^(root\.\d+(?:\.children\.\d+)*)\.rows\.(\d+)\.cells\.(\d+)$/;

export function tableCellPathContextFromPath(path: string): TableCellPathContext | null {
  const match = tableCellPathPattern.exec(path);
  if (!match) {
    return null;
  }

  const tablePath = match[1]!;
  if (!isBlockPath(tablePath)) {
    return null;
  }

  const rowIndex = pathIndexFromSegment(match[2]);
  const cellIndex = pathIndexFromSegment(match[3]);
  if (rowIndex === null || cellIndex === null) {
    return null;
  }

  return {
    cellIndex,
    rowIndex,
    tablePath,
  };
}

function pathIndexFromSegment(segment: string | undefined) {
  if (!segment || !/^\d+$/.test(segment)) {
    return null;
  }

  const value = Number(segment);
  return isValidPathIndex(value) ? value : null;
}

function isValidPathIndex(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

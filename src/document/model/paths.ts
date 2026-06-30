// Canonical structural path builders used by document traversal, indexing, and
// anchors. Paths are not stored on nodes; they are deterministic coordinates
// derived from the node's position in the semantic tree.

export type TableCellPathPosition = {
  cellIndex: number;
  rowIndex: number;
};

export type TableCellPathContext = TableCellPathPosition & {
  tablePath: string;
};

export type BlockPathCoordinates = {
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

export function isBlockPath(path: string) {
  return blockPathRootIndex(path) !== null;
}

export function rootIndexForPath(path: string) {
  return readRootIndex(path);
}

export function blockPathCoordinates(path: string): BlockPathCoordinates | null {
  return readBlockPath(path);
}

export function blockPathFromCoordinates(
  rootIndex: number,
  childIndices: readonly number[] = [],
) {
  if (!isValidPathIndex(rootIndex) || childIndices.some((index) => !isValidPathIndex(index))) {
    return null;
  }

  return childIndices.reduce(childBlockPath, rootBlockPath(rootIndex));
}

export function blockPathWithRootIndex(path: string, rootIndex: number) {
  const blockPath = readBlockPath(path);

  return blockPath ? blockPathFromCoordinates(rootIndex, blockPath.childIndices) : null;
}

export function blockPathSiblingIndex(path: string) {
  return readBlockPath(path)?.siblingIndex ?? null;
}

export function parentBlockPath(path: string) {
  const blockPath = readBlockPath(path);

  if (!blockPath) {
    return readTableCellPath(path)?.tablePath ?? null;
  }

  if (blockPath.childIndices.length === 0) {
    return null;
  }

  const parentChildIndices = blockPath.childIndices.slice(0, -1);
  return blockPathFromCoordinates(blockPath.rootIndex, parentChildIndices);
}

export function blockPathContainsPath(ancestorBlockPath: string, descendantPath: string) {
  const ancestor = readBlockPath(ancestorBlockPath);
  const descendant = readContainingBlockPath(descendantPath);

  if (!ancestor || !descendant) {
    return false;
  }

  return containsBlockCoordinates(ancestor, descendant);
}

export function tableCellPositionFromPath(path: string): TableCellPathPosition | null {
  const cellPath = readTableCellPath(path);

  return cellPath
    ? { cellIndex: cellPath.cellIndex, rowIndex: cellPath.rowIndex }
    : null;
}

export function tableCellPathContextFromPath(path: string): TableCellPathContext | null {
  return readTableCellPath(path);
}

const tableCellPathPattern =
  /^(root\.\d+(?:\.children\.\d+)*)\.rows\.(\d+)\.cells\.(\d+)$/;
const tableRowPathPattern = /^(root\.\d+(?:\.children\.\d+)*)\.rows\.(\d+)$/;

function readRootIndex(path: string) {
  const [prefix, rootIndexSegment] = path.split(".", 2);

  if (prefix !== "root" || rootIndexSegment === undefined) {
    return null;
  }

  return pathIndexFromSegment(rootIndexSegment);
}

function blockPathRootIndex(path: string) {
  return readBlockPath(path)?.rootIndex ?? null;
}

function readBlockPath(path: string) {
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

function readTableCellPath(path: string) {
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

function readTableRowPath(path: string) {
  const match = tableRowPathPattern.exec(path);
  if (!match) {
    return null;
  }

  const tablePath = match[1]!;
  if (!isBlockPath(tablePath)) {
    return null;
  }

  const rowIndex = pathIndexFromSegment(match[2]);
  return rowIndex === null ? null : { rowIndex, tablePath };
}

function readContainingBlockPath(path: string) {
  return (
    readBlockPath(path) ??
    readChildContainerOwnerPath(path) ??
    readSourceOwnerPath(path) ??
    readTableRowOwnerPath(path) ??
    readTableCellOwnerPath(path)
  );
}

function readChildContainerOwnerPath(path: string) {
  return readSuffixedBlockPath(path, ".children");
}

function readSourceOwnerPath(path: string) {
  return readSuffixedBlockPath(path, ".source");
}

function readTableRowOwnerPath(path: string) {
  const rowPath = readTableRowPath(path);
  return rowPath ? readBlockPath(rowPath.tablePath) : null;
}

function readTableCellOwnerPath(path: string) {
  const cellPath = readTableCellPath(path);
  return cellPath ? readBlockPath(cellPath.tablePath) : null;
}

function readSuffixedBlockPath(path: string, suffix: string) {
  return path.endsWith(suffix) ? readBlockPath(path.slice(0, -suffix.length)) : null;
}

function containsBlockCoordinates(
  ancestor: BlockPathCoordinates,
  descendant: BlockPathCoordinates,
) {
  if (
    ancestor.rootIndex !== descendant.rootIndex ||
    ancestor.childIndices.length > descendant.childIndices.length
  ) {
    return false;
  }

  return ancestor.childIndices.every((childIndex, index) => {
    return descendant.childIndices[index] === childIndex;
  });
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

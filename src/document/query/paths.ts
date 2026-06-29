// Structural path lookup for immutable document snapshots. Paths are
// snapshot-local coordinates, not durable identity.

import {
  blockPathCoordinates,
  getBlockChildren,
  parentBlockPath,
  tableCellPositionFromPath,
  type Block,
  type Document,
  type TableBlock,
  type TableCell,
  type TableRow,
} from "../model";

export type TableCellPathMatch = {
  cell: TableCell;
  cellIndex: number;
  nextCell: TableCell | null;
  nextRow: TableRow | null;
  previousCell: TableCell | null;
  previousRow: TableRow | null;
  row: TableRow;
  rowIndex: number;
  table: TableBlock;
};

export function resolveBlockByPath(document: Document, path: string): Block | null {
  const coordinates = blockPathCoordinates(path);
  if (!coordinates) {
    return null;
  }

  let block: Block | null = document.blocks[coordinates.rootIndex] ?? null;

  if (!block) {
    return null;
  }

  for (const childIndex of coordinates.childIndices) {
    const children = getBlockChildren(block);
    block = children?.[childIndex] ?? null;

    if (!block) {
      return null;
    }
  }

  return block;
}

export function resolveTableCellByPath(document: Document, path: string): TableCell | null {
  return resolveTableCellPathMatch(document, path)?.cell ?? null;
}

export function resolveTableCellPathMatch(
  document: Document,
  path: string,
): TableCellPathMatch | null {
  const tablePath = parentBlockPath(path);
  const position = tableCellPositionFromPath(path);
  if (!tablePath || !position) {
    return null;
  }

  const table = resolveBlockByPath(document, tablePath) as TableBlock | null;
  if (table?.type !== "table") {
    return null;
  }

  const row = table.rows[position.rowIndex];
  const cell = row?.cells[position.cellIndex];
  if (!row || !cell) {
    return null;
  }

  return createTableCellPathMatch(
    table,
    row,
    cell,
    position.rowIndex,
    position.cellIndex,
  );
}

export function createTableCellPathMatch(
  table: TableBlock,
  row: TableRow,
  cell: TableCell,
  rowIndex: number,
  cellIndex: number,
): TableCellPathMatch {
  return {
    cell,
    cellIndex,
    nextCell: row.cells[cellIndex + 1] ?? null,
    nextRow: table.rows[rowIndex + 1] ?? null,
    previousCell: row.cells[cellIndex - 1] ?? null,
    previousRow: table.rows[rowIndex - 1] ?? null,
    row,
    rowIndex,
    table,
  };
}

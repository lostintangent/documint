// Structural path lookup for immutable document snapshots. Paths are
// snapshot-local coordinates, not durable identity.

import {
  getBlockChildren,
  type Block,
  type Document,
  type TableBlock,
  type TableCell,
  type TableRow,
} from "../model";
import { visitDocument } from "./visit";

const blockPathPattern = /^root\.\d+(?:\.children\.\d+)*$/;
const tableCellPathPattern = /^(root\.\d+(?:\.children\.\d+)*)\.rows\.(\d+)\.cells\.(\d+)$/;

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

export type BlockPathMatch = {
  block: Block;
  path: string;
};

export function resolveBlockByPath(document: Document, path: string): Block | null {
  if (!blockPathPattern.test(path)) {
    return null;
  }

  const segments = path.split(".");
  const rootIndex = Number(segments[1]);
  let block: Block | null = isValidPathIndex(rootIndex)
    ? (document.blocks[rootIndex] ?? null)
    : null;

  if (!block) {
    return null;
  }

  for (let index = 2; index < segments.length; index += 2) {
    if (segments[index] !== "children") {
      return null;
    }

    const childIndex = Number(segments[index + 1]);
    const children = getBlockChildren(block);
    block = isValidPathIndex(childIndex) ? (children?.[childIndex] ?? null) : null;

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
  const parsed = parseTableCellPath(path);
  if (!parsed) {
    return null;
  }

  const table = resolveBlockByPath(document, parsed.tablePath) as TableBlock | null;
  if (table?.type !== "table") {
    return null;
  }

  const row = table.rows[parsed.rowIndex];
  const cell = row?.cells[parsed.cellIndex];
  if (!row || !cell) {
    return null;
  }

  return createTableCellPathMatch(table, row, cell, parsed.rowIndex, parsed.cellIndex);
}

export function findBlockWithPathById(
  document: Document,
  blockId: string,
): BlockPathMatch | null {
  let match: BlockPathMatch | null = null;

  visitDocument(document, {
    enterBlock(block, context) {
      if (block.id === blockId) {
        match = { block, path: context.path };
        return "stop";
      }
    },
  });

  return match;
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

function parseTableCellPath(path: string) {
  const match = tableCellPathPattern.exec(path);
  if (!match) {
    return null;
  }

  const rowIndex = Number(match[2]);
  const cellIndex = Number(match[3]);
  if (!isValidPathIndex(rowIndex) || !isValidPathIndex(cellIndex)) {
    return null;
  }

  return {
    cellIndex,
    rowIndex,
    tablePath: match[1]!,
  };
}

function isValidPathIndex(value: number) {
  return Number.isInteger(value) && value >= 0;
}

import {
  createLineBreak,
  createParagraphTextBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  getTableColumnCount,
  rebuildTableBlock,
  rootBlockPath,
  type Block,
  type TableBlock,
  type TableCell,
  type TableRow,
} from "@/document";
import { target, type SelectionTarget } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import type { RootTextBlockContext, TableCellContext } from "../../context";
import { createInlineReplacementAction, spliceInlineContainer } from "../inlines/shared";
import { insertAt, removeAt, spliceAt } from "./shared";

// Table block actions for insertion, cell navigation, row/column structure,
// table-cell line breaks, and whole-table deletion. Public resolvers describe
// table behavior; table rebuilding, selection targets, and array mechanics
// stay in local helpers below.

type TableActionIntent = {
  selection: SelectionTarget;
};

export function resolveTableInsertion(
  context: RootTextBlockContext,
  columnCount: number,
): EditorStateAction {
  return {
    kind: "splice-blocks",
    blocks: [createEmptyTable(Math.max(2, columnCount))],
    rootIndex: context.rootIndex,
    selection: target.tableCell(rootBlockPath(context.rootIndex), 0, 0),
  };
}

export function resolveTableSelectionMove(
  context: TableCellContext,
  direction: -1 | 1,
): EditorStateAction {
  const cells = context.indexedTable.tableCellRows.flat();
  const nextCell =
    cells[cells.findIndex((cell) => cell.path === context.indexedCell.path) + direction];

  if (!nextCell) {
    return direction > 0 ? appendEmptyTableRow(context) : { kind: "keep-state" };
  }

  // The caret keeps its offset, which the reducer clamps to the next cell's text.
  const point = { path: nextCell.path, offset: context.selection.focus.offset };

  return { kind: "set-selection", selection: { anchor: point, focus: point } };
}

export function resolveTableCellLineBreak(context: TableCellContext): EditorStateAction {
  const startOffset = Math.min(context.selection.anchor.offset, context.selection.focus.offset);
  const endOffset = Math.max(context.selection.anchor.offset, context.selection.focus.offset);

  return createInlineReplacementAction(
    spliceInlineContainer(context.inlineContainer, startOffset, endOffset, [createLineBreak()]),
  );
}

export function resolveTableColumnInsertion(
  context: TableCellContext,
  direction: "left" | "right",
): EditorStateAction | null {
  const cellIndex =
    direction === "left" ? context.indexedCell.cellIndex : context.indexedCell.cellIndex + 1;

  return replaceTable(context, insertTableColumn(context.indexedTable.block, cellIndex), {
    selection: selectTableCell(context, context.indexedCell.rowIndex, cellIndex),
  });
}

export function resolveTableColumnDeletion(context: TableCellContext): EditorStateAction | null {
  if (getTableColumnCount(context.indexedTable.block) <= 1) {
    return null;
  }

  const table = deleteTableColumn(context.indexedTable.block, context.indexedCell.cellIndex);

  return replaceTable(context, table, {
    selection: selectNearestTableCell(context, table),
  });
}

export function resolveTableRowInsertion(
  context: TableCellContext,
  direction: "above" | "below",
): EditorStateAction | null {
  const rowIndex =
    direction === "above" ? context.indexedCell.rowIndex : context.indexedCell.rowIndex + 1;

  return replaceTable(context, insertTableRow(context.indexedTable.block, rowIndex), {
    selection: selectTableCell(context, rowIndex, context.indexedCell.cellIndex),
  });
}

export function resolveTableRowDeletion(context: TableCellContext): EditorStateAction | null {
  if (context.indexedTable.block.rows.length <= 1) {
    return null;
  }

  const table = deleteTableRow(context.indexedTable.block, context.indexedCell.rowIndex);

  return replaceTable(context, table, {
    selection: selectNearestTableCell(context, table),
  });
}

export function resolveTableDeletion(context: TableCellContext): EditorStateAction {
  const paragraph = createParagraphTextBlock("");

  return replaceTable(context, paragraph, {
    selection: target.block(paragraph),
  });
}

function appendEmptyTableRow(context: TableCellContext): EditorStateAction {
  const rowIndex = context.indexedTable.block.rows.length;

  return replaceTable(context, insertTableRow(context.indexedTable.block, rowIndex), {
    selection: selectTableCell(context, rowIndex, 0),
  });
}

function insertTableColumn(table: TableBlock, cellIndex: number): TableBlock {
  return createTableBlock({
    align: spliceAt(table.align, cellIndex, 0, [null]),
    rows: table.rows.map((row) =>
      createTableRow(spliceAt(row.cells, cellIndex, 0, [createEmptyTableCell()])),
    ),
  });
}

function deleteTableColumn(table: TableBlock, cellIndex: number): TableBlock {
  return createTableBlock({
    align: removeAt(table.align, cellIndex),
    rows: table.rows.map((row) => createTableRow(removeAt(row.cells, cellIndex))),
  });
}

function insertTableRow(table: TableBlock, rowIndex: number): TableBlock {
  const row = createEmptyTableRow(getTableColumnCount(table));

  return rebuildTableBlock(table, insertAt(table.rows, rowIndex, row));
}

function deleteTableRow(table: TableBlock, rowIndex: number): TableBlock {
  return rebuildTableBlock(table, removeAt(table.rows, rowIndex));
}

function replaceTable(
  context: TableCellContext,
  block: Block,
  intent: TableActionIntent,
): EditorStateAction {
  return {
    kind: "replace-block",
    block,
    blockPath: context.indexedTable.path,
    selection: intent.selection,
  };
}

// Clamps the caret onto a cell that survives the deletion.
function selectNearestTableCell(context: TableCellContext, table: TableBlock): SelectionTarget {
  const rowIndex = Math.min(context.indexedCell.rowIndex, table.rows.length - 1);
  const cellCount = table.rows[rowIndex]!.cells.length;

  return selectTableCell(context, rowIndex, Math.min(context.indexedCell.cellIndex, cellCount - 1));
}

function selectTableCell(
  context: TableCellContext,
  rowIndex: number,
  cellIndex: number,
): SelectionTarget {
  return target.tableCell(context.indexedTable.path, rowIndex, cellIndex);
}

function createEmptyTable(columnCount: number): TableBlock {
  return createTableBlock({
    rows: Array.from({ length: 2 }, () => createEmptyTableRow(columnCount)),
  });
}

function createEmptyTableRow(columnCount: number): TableRow {
  return createTableRow(Array.from({ length: columnCount }, () => createEmptyTableCell()));
}

function createEmptyTableCell(): TableCell {
  return createTableCell([]);
}

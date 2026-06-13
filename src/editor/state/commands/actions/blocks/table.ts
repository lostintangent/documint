import {
  createLineBreak,
  createParagraphTextBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  rebuildTableBlock,
  type Block,
  type TableBlock,
  type TableCell,
  type TableRow,
} from "@/document";
import { resolveTableCellRegion } from "../../../index/query";
import type { DocumentIndex } from "../../../index/types";
import { target, type EditorSelection, type SelectionTarget } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import type { RootBlockInsertionContext, TableCellContext } from "../../context";
import { spliceInlineContainer } from "../inlines/shared";
import { insertAt, removeAt, spliceAt } from "./shared";

// Table block actions for insertion, cell navigation, row/column structure,
// table-cell line breaks, and whole-table deletion. Public resolvers describe
// table behavior; table rebuilding, selection targets, and array mechanics
// stay in local helpers below.

type TableActionIntent = {
  selection: SelectionTarget;
};

type TableCellPosition = {
  cellIndex: number;
  rowIndex: number;
};

export function resolveTableInsertion(
  context: RootBlockInsertionContext,
  columnCount: number,
): EditorStateAction {
  const table = createEmptyTable(Math.max(2, columnCount));

  return insertTableAtRoot(context, table);
}

export function resolveTableSelectionMove(
  context: TableCellContext,
  direction: -1 | 1,
): EditorStateAction | null {
  const nextPosition = resolveTableCellMove(
    context.table,
    context.rowIndex,
    context.cellIndex,
    direction,
  );

  if (!nextPosition) {
    return direction > 0 && isLastTableCell(context.table, context.rowIndex, context.cellIndex)
      ? appendEmptyTableRow(context)
      : { kind: "keep-state" };
  }

  return moveSelectionToTableCell(context, nextPosition);
}

export function resolveTableCellLineBreak(context: TableCellContext): EditorStateAction | null {
  const startOffset = Math.min(context.selection.anchor.offset, context.selection.focus.offset);
  const endOffset = Math.max(context.selection.anchor.offset, context.selection.focus.offset);
  const replacement = spliceInlineContainer(context.inlineContainer, startOffset, endOffset, [
    createLineBreak(),
  ]);

  return {
    kind: "replace-block",
    block: replacement.block,
    blockId: replacement.blockId,
    selection: replacement.selection,
  };
}

export function resolveTableColumnInsertion(
  context: TableCellContext,
  direction: "left" | "right",
): EditorStateAction | null {
  const cellIndex = direction === "left" ? context.cellIndex : context.cellIndex + 1;

  return replaceTable(context, insertTableColumn(context.table, cellIndex), {
    selection: selectTableCell(context, context.rowIndex, cellIndex),
  });
}

export function resolveTableColumnDeletion(context: TableCellContext): EditorStateAction | null {
  const columnCount = tableColumnCount(context.table);

  if (columnCount <= 1) {
    return null;
  }

  return replaceTable(context, deleteTableColumn(context.table, context.cellIndex), {
    selection: selectTableCell(
      context,
      context.rowIndex,
      clampCellIndex(context.cellIndex, columnCount - 1),
    ),
  });
}

export function resolveTableRowInsertion(
  context: TableCellContext,
  direction: "above" | "below",
): EditorStateAction | null {
  const rowIndex = direction === "above" ? context.rowIndex : context.rowIndex + 1;
  const columnCount = tableColumnCount(context.table);

  return replaceTable(context, insertTableRow(context.table, rowIndex), {
    selection: selectTableCell(context, rowIndex, clampCellIndex(context.cellIndex, columnCount)),
  });
}

export function resolveTableRowDeletion(context: TableCellContext): EditorStateAction | null {
  if (context.table.rows.length <= 1) {
    return null;
  }

  const table = deleteTableRow(context.table, context.rowIndex);
  const rowIndex = clampRowIndex(context.rowIndex, table.rows.length);
  const columnCount = table.rows[rowIndex]?.cells.length ?? 1;

  return replaceTable(context, table, {
    selection: selectTableCell(context, rowIndex, clampCellIndex(context.cellIndex, columnCount)),
  });
}

export function resolveTableDeletion(context: TableCellContext): EditorStateAction | null {
  return replaceTableWithParagraph(context);
}

function appendEmptyTableRow(context: TableCellContext): EditorStateAction {
  const rowIndex = context.table.rows.length;

  return replaceTable(context, insertTableRow(context.table, rowIndex), {
    selection: selectTableCell(context, rowIndex, 0),
  });
}

function moveSelectionToTableCell(
  context: TableCellContext,
  position: TableCellPosition,
): EditorStateAction {
  const nextCell = context.table.rows[position.rowIndex]?.cells[position.cellIndex];

  if (!nextCell) {
    return { kind: "keep-state" };
  }

  return {
    kind: "set-selection",
    selection: createTableCellSelection(
      context.documentIndex,
      context.selection,
      context.table,
      position.rowIndex,
      position.cellIndex,
      Math.min(context.selection.focus.offset, nextCell.plainText.length),
    ),
  };
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
  const row = createEmptyTableRow(tableColumnCount(table));

  return rebuildTableBlock(table, insertAt(table.rows, rowIndex, row));
}

function deleteTableRow(table: TableBlock, rowIndex: number): TableBlock {
  return rebuildTableBlock(table, removeAt(table.rows, rowIndex));
}

function replaceTableWithParagraph(context: TableCellContext): EditorStateAction {
  const paragraph = createParagraphTextBlock("");

  return replaceTable(context, paragraph, {
    selection: target.block(paragraph),
  });
}

function insertTableAtRoot(
  context: RootBlockInsertionContext,
  table: TableBlock,
): EditorStateAction {
  return {
    kind: "splice-blocks",
    blocks: [table],
    rootIndex: context.rootIndex,
    selection: target.tableCell(context.rootIndex, 0, 0),
  };
}

function replaceTable(
  context: TableCellContext,
  block: Block,
  intent: TableActionIntent,
): EditorStateAction {
  return {
    kind: "replace-block",
    block,
    blockId: context.table.id,
    selection: intent.selection,
  };
}

function selectTableCell(
  context: TableCellContext,
  rowIndex: number,
  cellIndex: number,
): SelectionTarget {
  return target.tableCell(context.rootIndex, rowIndex, cellIndex);
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

function tableColumnCount(table: TableBlock): number {
  return Math.max(1, ...table.rows.map((row) => row.cells.length));
}

function clampRowIndex(rowIndex: number, rowCount: number): number {
  return Math.min(rowIndex, rowCount - 1);
}

function clampCellIndex(cellIndex: number, columnCount: number): number {
  return Math.min(cellIndex, columnCount - 1);
}

function createTableCellSelection(
  documentIndex: DocumentIndex,
  fallbackSelection: EditorSelection,
  table: TableBlock,
  rowIndex: number,
  cellIndex: number,
  offset: number,
): EditorSelection {
  const region = resolveTableCellRegion(documentIndex, table.id, rowIndex, cellIndex);

  if (!region) {
    return fallbackSelection;
  }

  return {
    anchor: { regionId: region.id, offset },
    focus: { regionId: region.id, offset },
  };
}

function resolveTableCellMove(
  table: TableBlock,
  rowIndex: number,
  cellIndex: number,
  direction: -1 | 1,
): TableCellPosition | null {
  return direction < 0
    ? resolvePreviousTableCell(table, rowIndex, cellIndex)
    : resolveNextTableCell(table, rowIndex, cellIndex);
}

function resolvePreviousTableCell(
  table: TableBlock,
  rowIndex: number,
  cellIndex: number,
): TableCellPosition | null {
  if (cellIndex > 0) {
    return { cellIndex: cellIndex - 1, rowIndex };
  }

  if (rowIndex > 0) {
    const previousRow = table.rows[rowIndex - 1];

    if (!previousRow || previousRow.cells.length === 0) {
      return null;
    }

    return {
      cellIndex: previousRow.cells.length - 1,
      rowIndex: rowIndex - 1,
    };
  }

  return null;
}

function resolveNextTableCell(
  table: TableBlock,
  rowIndex: number,
  cellIndex: number,
): TableCellPosition | null {
  const row = table.rows[rowIndex];

  if (!row) {
    return null;
  }

  if (cellIndex + 1 < row.cells.length) {
    return { cellIndex: cellIndex + 1, rowIndex };
  }

  const nextRow = table.rows[rowIndex + 1];

  if (!nextRow || nextRow.cells.length === 0) {
    return null;
  }

  return {
    cellIndex: 0,
    rowIndex: rowIndex + 1,
  };
}

function isLastTableCell(table: TableBlock, rowIndex: number, cellIndex: number) {
  const row = table.rows[rowIndex];

  return Boolean(row && rowIndex === table.rows.length - 1 && cellIndex === row.cells.length - 1);
}

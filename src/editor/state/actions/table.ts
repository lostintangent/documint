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
import type { DocumentIndex } from "../index/types";
import type { EditorStateAction } from "../types";
import { insertInlineNodeIntoTarget, resolveInlineRegionTarget } from "./inline";
import {
  createRootPrimaryRegionTarget,
  createTableCellTarget,
  resolveTableCellRegion,
  type EditorSelection,
} from "../selection";
import {
  resolveRootTextBlockContext,
  type TableCellContext,
} from "../index/context";

// Table action resolvers: insert/delete rows and columns, cell navigation,
// and table deletion. Most take a pre-resolved TableCellContext so
// commands handle "is the selection in a table cell?" once at the boundary.

export function resolveTableInsertion(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  columnCount: number,
): EditorStateAction | null {
  const context = resolveRootTextBlockContext(documentIndex, selection);
  const resolvedColumnCount = Math.max(2, columnCount);

  if (
    !context ||
    context.block.type !== "paragraph" ||
    context.block.plainText.length > 0 ||
    selection.anchor.regionId !== selection.focus.regionId ||
    selection.anchor.offset !== 0 ||
    selection.focus.offset !== 0
  ) {
    return null;
  }

  return {
    kind: "splice-blocks",
    blocks: [
      createTableBlock({
        rows: Array.from({ length: 2 }, () => createEmptyTableRow(resolvedColumnCount)),
      }),
    ],
    rootIndex: context.rootIndex,
    selection: createTableCellTarget(context.rootIndex, 0, 0),
  };
}

export function resolveTableSelectionMove(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  context: TableCellContext,
  direction: -1 | 1,
): EditorStateAction | null {
  const nextPosition =
    direction < 0
      ? resolvePreviousTableCell(context.table, context.rowIndex, context.cellIndex)
      : resolveNextTableCell(context.table, context.rowIndex, context.cellIndex);

  if (!nextPosition) {
    return direction > 0 && isLastTableCell(context.table, context.rowIndex, context.cellIndex)
      ? appendTableRow(context)
      : { kind: "keep-state" };
  }

  const nextCell = context.table.rows[nextPosition.rowIndex]?.cells[nextPosition.cellIndex];

  if (!nextCell) {
    return { kind: "keep-state" };
  }

  return {
    kind: "set-selection",
    selection: createTableCellSelection(
      documentIndex,
      selection,
      context.table,
      nextPosition.rowIndex,
      nextPosition.cellIndex,
      Math.min(selection.focus.offset, nextCell.plainText.length),
    ),
  };
}

export function resolveTableCellLineBreak(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): EditorStateAction | null {
  const target = resolveInlineRegionTarget(documentIndex, selection.focus.regionId);

  if (!target || target.kind !== "tableCell") {
    return null;
  }

  const startOffset = Math.min(selection.anchor.offset, selection.focus.offset);
  const endOffset = Math.max(selection.anchor.offset, selection.focus.offset);
  const replacement = insertInlineNodeIntoTarget(target, startOffset, endOffset, (path) =>
    createLineBreak({ path }),
  );

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
  const insertCellIndex = direction === "left" ? context.cellIndex : context.cellIndex + 1;

  return replaceTableBlock(
    context,
    createTableBlock({
      align: spliceTableAlign(context.table.align, insertCellIndex, 0, [null]),
      rows: context.table.rows.map((row) =>
        createTableRow({
          cells: spliceTableRowCells(row.cells, insertCellIndex, 0, [createEmptyTableCell()]),
        }),
      ),
    }),
    createTableCellTarget(context.rootIndex, context.rowIndex, insertCellIndex),
  );
}

export function resolveTableColumnDeletion(context: TableCellContext): EditorStateAction | null {
  const columnCount = Math.max(0, ...context.table.rows.map((row) => row.cells.length));

  if (columnCount <= 1) {
    return null;
  }

  return replaceTableBlock(
    context,
    createTableBlock({
      align: spliceTableAlign(context.table.align, context.cellIndex, 1, []),
      rows: context.table.rows.map((row) =>
        createTableRow({
          cells: row.cells.filter((_, cellIndex) => cellIndex !== context.cellIndex),
        }),
      ),
    }),
    createTableCellTarget(
      context.rootIndex,
      context.rowIndex,
      Math.min(context.cellIndex, columnCount - 2),
    ),
  );
}

export function resolveTableRowInsertion(
  context: TableCellContext,
  direction: "above" | "below",
): EditorStateAction | null {
  const insertRowIndex = direction === "above" ? context.rowIndex : context.rowIndex + 1;
  const columnCount = Math.max(1, ...context.table.rows.map((row) => row.cells.length));

  return replaceTableBlock(
    context,
    rebuildTableBlock(context.table, [
      ...context.table.rows.slice(0, insertRowIndex),
      createEmptyTableRow(columnCount),
      ...context.table.rows.slice(insertRowIndex),
    ]),
    createTableCellTarget(
      context.rootIndex,
      insertRowIndex,
      Math.min(context.cellIndex, columnCount - 1),
    ),
  );
}

export function resolveTableRowDeletion(context: TableCellContext): EditorStateAction | null {
  if (context.table.rows.length <= 1) {
    return null;
  }

  const nextRows = context.table.rows.filter((_, rowIndex) => rowIndex !== context.rowIndex);
  const nextRowIndex = Math.min(context.rowIndex, nextRows.length - 1);
  const nextColumnCount = nextRows[nextRowIndex]?.cells.length ?? 1;

  return replaceTableBlock(
    context,
    rebuildTableBlock(context.table, nextRows),
    createTableCellTarget(
      context.rootIndex,
      nextRowIndex,
      Math.min(context.cellIndex, nextColumnCount - 1),
    ),
  );
}

export function resolveTableDeletion(context: TableCellContext): EditorStateAction | null {
  return replaceTableBlock(
    context,
    createParagraphTextBlock({
      text: "",
    }),
    createRootPrimaryRegionTarget(context.rootIndex),
  );
}

function createEmptyTableRow(columnCount: number): TableRow {
  return createTableRow({
    cells: Array.from({ length: columnCount }, () => createEmptyTableCell()),
  });
}

function createEmptyTableCell(): TableCell {
  return createTableCell({
    children: [],
  });
}

function appendTableRow(context: TableCellContext): EditorStateAction {
  const nextRowIndex = context.table.rows.length;
  const columnCount = Math.max(1, ...context.table.rows.map((row) => row.cells.length));

  return replaceTableBlock(
    context,
    rebuildTableBlock(context.table, [...context.table.rows, createEmptyTableRow(columnCount)]),
    createTableCellTarget(context.rootIndex, nextRowIndex, 0),
  );
}

function replaceTableBlock(
  context: TableCellContext,
  block: Block,
  selection:
    | ReturnType<typeof createRootPrimaryRegionTarget>
    | ReturnType<typeof createTableCellTarget>,
): EditorStateAction {
  return {
    kind: "replace-block",
    block,
    blockId: context.table.id,
    selection,
  };
}

function spliceTableRowCells(
  cells: TableCell[],
  start: number,
  deleteCount: number,
  insertions: TableCell[],
) {
  return [...cells.slice(0, start), ...insertions, ...cells.slice(start + deleteCount)];
}

function spliceTableAlign(
  align: TableBlock["align"],
  start: number,
  deleteCount: number,
  insertions: Array<TableBlock["align"][number]>,
) {
  return [...align.slice(0, start), ...insertions, ...align.slice(start + deleteCount)];
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

function resolvePreviousTableCell(table: TableBlock, rowIndex: number, cellIndex: number) {
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

function resolveNextTableCell(table: TableBlock, rowIndex: number, cellIndex: number) {
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

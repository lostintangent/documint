// Table-specific edit commands. This module owns cell-to-cell tab navigation
// and last-cell row growth without leaking row/cell plumbing into the general
// command entrypoints.
import {
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
import {
  insertInlineLineBreakTarget,
  resolveInlineCommandTarget,
  type CanvasSelection,
  type EditorSelectionTarget,
} from "../document-editor";
import type { EditorState } from "../state";

type TableOperationHelpers = {
  applyBlockReplacement: (
    state: EditorState,
    targetBlockId: string,
    replacement: Block,
    selection?: CanvasSelection | EditorSelectionTarget,
  ) => EditorState | null;
  focusTableCell: (
    rootIndex: number,
    rowIndex: number,
    cellIndex: number,
    offset?: number | "end",
  ) => EditorSelectionTarget;
  focusRootPrimaryRegion: (
    rootIndex: number,
    offset?: number | "end",
  ) => EditorSelectionTarget;
  setSelection: (state: EditorState, selection: CanvasSelection) => EditorState;
};

export function handleTableTabOperation(
  state: EditorState,
  direction: -1 | 1,
  helpers: TableOperationHelpers,
) {
  const context = resolveTableCellContext(state);

  if (!context) {
    return null;
  }

  const nextPosition =
    direction < 0
      ? resolvePreviousTableCell(context.table, context.rowIndex, context.cellIndex)
      : resolveNextTableCell(context.table, context.rowIndex, context.cellIndex);

  if (!nextPosition) {
    return direction > 0 && isLastTableCell(context.table, context.rowIndex, context.cellIndex)
      ? appendTableRow(state, context, helpers)
      : state;
  }

  const nextCell = context.table.rows[nextPosition.rowIndex]?.cells[nextPosition.cellIndex];

  if (!nextCell) {
    return state;
  }

  return helpers.setSelection(
    state,
    createTableCellSelection(
      state,
      context.table,
      nextPosition.rowIndex,
      nextPosition.cellIndex,
      Math.min(state.selection.focus.offset, nextCell.plainText.length),
    ),
  );
}

export function insertTableCellLineBreakOperation(
  state: EditorState,
  helpers: TableOperationHelpers,
) {
  const container = state.documentEditor.regionIndex.get(state.selection.focus.regionId);
  const context = resolveTableCellContext(state);

  if (!container || !context) {
    return null;
  }

  const target = resolveInlineCommandTarget(
    context.table,
    container.path,
    container.semanticRegionId,
  );

  if (!target || target.kind !== "tableCell") {
    return null;
  }

  const startOffset = Math.min(state.selection.anchor.offset, state.selection.focus.offset);
  const endOffset = Math.max(state.selection.anchor.offset, state.selection.focus.offset);
  const replacement = insertInlineLineBreakTarget(target, startOffset, endOffset);

  return helpers.applyBlockReplacement(
    state,
    replacement.blockId,
    replacement.block,
    replacement.selection,
  );
}

export function insertTableColumnOperation(
  state: EditorState,
  direction: "left" | "right",
  helpers: TableOperationHelpers,
) {
  const context = resolveTableCellContext(state);

  if (!context) {
    return null;
  }

  const insertCellIndex = direction === "left" ? context.cellIndex : context.cellIndex + 1;
  const nextRows = context.table.rows.map((row) =>
    createTableRow({
      cells: spliceTableRowCells(row.cells, insertCellIndex, 0, [createEmptyTableCell()]),
    }),
  );
  const nextTable = createTableBlock({
    align: spliceTableAlign(context.table.align, insertCellIndex, 0, [null]),
    rows: nextRows,
  });

  return helpers.applyBlockReplacement(
    state,
    context.table.id,
    nextTable,
    helpers.focusTableCell(context.rootIndex, context.rowIndex, insertCellIndex),
  );
}

export function deleteTableColumnOperation(
  state: EditorState,
  helpers: TableOperationHelpers,
) {
  const context = resolveTableCellContext(state);

  if (!context) {
    return null;
  }

  const columnCount = Math.max(0, ...context.table.rows.map((row) => row.cells.length));

  if (columnCount <= 1) {
    return null;
  }

  const nextRows = context.table.rows.map((row) =>
    createTableRow({
      cells: row.cells.filter((_, cellIndex) => cellIndex !== context.cellIndex),
    }),
  );
  const nextTable = createTableBlock({
    align: spliceTableAlign(context.table.align, context.cellIndex, 1, []),
    rows: nextRows,
  });
  const nextCellIndex = Math.min(context.cellIndex, columnCount - 2);

  return helpers.applyBlockReplacement(
    state,
    context.table.id,
    nextTable,
    helpers.focusTableCell(context.rootIndex, context.rowIndex, nextCellIndex),
  );
}

export function insertTableRowOperation(
  state: EditorState,
  direction: "above" | "below",
  helpers: TableOperationHelpers,
) {
  const context = resolveTableCellContext(state);

  if (!context) {
    return null;
  }

  const insertRowIndex = direction === "above" ? context.rowIndex : context.rowIndex + 1;
  const columnCount = Math.max(1, ...context.table.rows.map((row) => row.cells.length));
  const nextRows = [
    ...context.table.rows.slice(0, insertRowIndex),
    createEmptyTableRow(columnCount),
    ...context.table.rows.slice(insertRowIndex),
  ];
  const nextTable = rebuildTableBlock(context.table, nextRows);

  return helpers.applyBlockReplacement(
    state,
    context.table.id,
    nextTable,
    helpers.focusTableCell(
      context.rootIndex,
      insertRowIndex,
      Math.min(context.cellIndex, columnCount - 1),
    ),
  );
}

export function deleteTableRowOperation(
  state: EditorState,
  helpers: TableOperationHelpers,
) {
  const context = resolveTableCellContext(state);

  if (!context || context.table.rows.length <= 1) {
    return null;
  }

  const nextRows = context.table.rows.filter((_, rowIndex) => rowIndex !== context.rowIndex);
  const nextTable = rebuildTableBlock(context.table, nextRows);
  const nextRowIndex = Math.min(context.rowIndex, nextRows.length - 1);
  const nextColumnCount = nextRows[nextRowIndex]?.cells.length ?? 1;

  return helpers.applyBlockReplacement(
    state,
    context.table.id,
    nextTable,
    helpers.focusTableCell(
      context.rootIndex,
      nextRowIndex,
      Math.min(context.cellIndex, nextColumnCount - 1),
    ),
  );
}

export function deleteTableOperation(
  state: EditorState,
  helpers: TableOperationHelpers,
) {
  const context = resolveTableCellContext(state);

  if (!context) {
    return null;
  }

  return helpers.applyBlockReplacement(
    state,
    context.table.id,
    createParagraphTextBlock({
      text: "",
    }),
    helpers.focusRootPrimaryRegion(context.rootIndex),
  );
}

function resolveTableCellContext(state: EditorState) {
  const container = state.documentEditor.regionIndex.get(state.selection.focus.regionId);

  if (!container) {
    return null;
  }
  const tableCellPosition = state.documentEditor.tableCellIndex.get(container.id);

  const tableEntry = state.documentEditor.blockIndex.get(container.blockId);
  const table =
    tableEntry?.type === "table"
      ? state.documentEditor.document.blocks[tableEntry.rootIndex]
      : null;

  if (!tableCellPosition || !tableEntry || !table || table.type !== "table") {
    return null;
  }

  return {
    cellIndex: tableCellPosition.cellIndex,
    rootIndex: tableEntry.rootIndex,
    rowIndex: tableCellPosition.rowIndex,
    table,
  };
}

function appendTableRow(
  state: EditorState,
  context: { rootIndex: number; table: TableBlock },
  helpers: TableOperationHelpers,
) {
  const nextRowIndex = context.table.rows.length;
  const columnCount = Math.max(1, ...context.table.rows.map((row) => row.cells.length));
  const nextRow = createEmptyTableRow(columnCount);
  const nextRows = [...context.table.rows, nextRow];
  const nextTable = rebuildTableBlock(context.table, nextRows);

  return helpers.applyBlockReplacement(
    state,
    context.table.id,
    nextTable,
    helpers.focusTableCell(context.rootIndex, nextRowIndex, 0),
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

function spliceTableRowCells(
  cells: TableCell[],
  start: number,
  deleteCount: number,
  insertions: TableCell[],
) {
  return [
    ...cells.slice(0, start),
    ...insertions,
    ...cells.slice(start + deleteCount),
  ];
}

function spliceTableAlign(
  align: TableBlock["align"],
  start: number,
  deleteCount: number,
  insertions: Array<TableBlock["align"][number]>,
) {
  return [
    ...align.slice(0, start),
    ...insertions,
    ...align.slice(start + deleteCount),
  ];
}

function createTableCellSelection(
  state: EditorState,
  table: TableBlock,
  rowIndex: number,
  cellIndex: number,
  offset: number,
): CanvasSelection {
  const region = state.documentEditor.regions.find(
    (entry) =>
      entry.blockId === table.id &&
      state.documentEditor.tableCellIndex.get(entry.id)?.rowIndex === rowIndex &&
      state.documentEditor.tableCellIndex.get(entry.id)?.cellIndex === cellIndex,
  );

  if (!region) {
    return state.selection;
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

// Table cell chrome resolves from cell bounds rather than lines, so a short
// cell in a tall row keeps its surface while any part of the row is in the
// paint window, even when its text is not.

import {
  findVisibleTableRowRange,
  type DocumentLayout,
  type LayoutRect,
  type PathBounds,
} from "@/editor/layout";
import { resolveIndexedBlock, type EditorState } from "@/editor/state";
import type { BlockFlashFrame } from "../../effects";

export type BandedGeometryFrame = {
  bands: readonly LayoutRect[];
  borderRect?: LayoutRect;
  rect: LayoutRect;
};

export type TableCellChromeFrame = {
  blockPath: string;
  isHeaderRow: boolean;
  path: string;
  rect: LayoutRect;
};

export type TableCellGeometryFrame = BandedGeometryFrame & { borderRect: LayoutRect };

export type ActiveTableCellGeometryFrame = TableCellGeometryFrame & {
  activeFlash: BlockFlashFrame | null;
};

export function resolveTableCellChrome({
  editorState,
  height,
  layout,
  top,
  visibleBlocks,
}: {
  editorState: EditorState;
  height: number;
  layout: DocumentLayout;
  top: number;
  visibleBlocks: { endIndex: number; startIndex: number };
}): TableCellChromeFrame[] {
  const cells: TableCellChromeFrame[] = [];

  for (let index = visibleBlocks.startIndex; index < visibleBlocks.endIndex; index += 1) {
    const { blockPath, type } = layout.blocks[index]!;
    const table =
      type === "table" ? resolveIndexedBlock(editorState.documentIndex, blockPath) : null;

    if (table?.kind !== "cells") {
      continue;
    }

    const rows = table.tableCellRows;
    const visibleRows = findVisibleTableRowRange(layout, rows, top, height);

    for (let rowIndex = visibleRows.startIndex; rowIndex < visibleRows.endIndex; rowIndex += 1) {
      for (const cell of rows[rowIndex]!) {
        const bounds = layout.pathBounds.get(cell.path);

        if (bounds) {
          cells.push({
            blockPath,
            isHeaderRow: rowIndex === 0,
            path: cell.path,
            rect: resolveTableCellPaintRect(bounds),
          });
        }
      }
    }
  }

  return cells;
}

export function resolveActiveTableCellGeometry({
  activeBlockPath,
  activePath,
  blockFlashes,
  cells,
}: {
  activeBlockPath: string | null;
  activePath: string | null;
  blockFlashes: ReadonlyMap<string, BlockFlashFrame>;
  cells: readonly TableCellChromeFrame[];
}): ActiveTableCellGeometryFrame | null {
  if (!activeBlockPath || !activePath) {
    return null;
  }

  const activeCell = cells.find(
    (cell) => cell.path === activePath && cell.blockPath === activeBlockPath,
  );

  return activeCell
    ? {
        ...resolveTableCellGeometryFrame(activeCell),
        activeFlash: blockFlashes.get(activeBlockPath) ?? null,
      }
    : null;
}

// One band over the whole cell, so a tint covers its padding as well as its text.
export function resolveTableCellGeometryFrame({
  rect,
}: TableCellChromeFrame): TableCellGeometryFrame {
  return { bands: [rect], borderRect: rect, rect };
}

// Cell bounds span the whole column and row, so tints and borders meet their neighbors exactly.
function resolveTableCellPaintRect(cellBounds: PathBounds): LayoutRect {
  return {
    height: cellBounds.bottom - cellBounds.top,
    left: cellBounds.left,
    top: cellBounds.top,
    width: cellBounds.right - cellBounds.left,
  };
}

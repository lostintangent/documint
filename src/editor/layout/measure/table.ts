// Owns exact table layout. Tables share row bands across multiple text paths,
// so they need a dedicated pass instead of single-path flow.

import type { Block } from "@/document";
import type { DocumentResources } from "@/editor/resources";
import type { IndexedBlock } from "../../state";
import type { DocumentLayoutOptions } from "../lib/options";
import { mergeLayoutBlockExtent, type LayoutBlockExtent } from "../lib/marker-metrics";
import type { DocumentLayout, LayoutLine } from "./index";
import { layoutTextContainerLines, resolveBlockTypography, sumLineHeights } from "./text";
import { tableCellLayoutTextInput } from "./text-input";
import type { LayoutCache } from "../state/cache";

export type TableColumnMetrics = {
  cellWidth: number;
  columnCount: number;
  columnWidth: number;
  tableWidth: number;
};

export const TABLE_CELL_PADDING_X = 10;
export const TABLE_CELL_PADDING_Y = 8;
export const TABLE_MIN_WIDTH = 120;

export function resolveTableColumnMetrics(
  block: Extract<Block, { type: "table" }>,
  left: number,
  options: DocumentLayoutOptions,
): TableColumnMetrics {
  const columnCount = Math.max(1, ...block.rows.map((row) => row.cells.length));
  const tableWidth = Math.max(TABLE_MIN_WIDTH, options.width - left - options.paddingX);
  const columnWidth = tableWidth / columnCount;

  return {
    cellWidth: Math.max(40, columnWidth - TABLE_CELL_PADDING_X * 2),
    columnCount,
    columnWidth,
    tableWidth,
  };
}

export function resolveTableRowHeight(lineHeight: number, cellContentHeights: number[]) {
  return Math.max(lineHeight, ...cellContentHeights) + TABLE_CELL_PADDING_Y * 2;
}

export function layoutTable(
  lines: LayoutLine[],
  blockExtents: Map<string, LayoutBlockExtent>,
  pathBounds: DocumentLayout["pathBounds"],
  indexedBlock: IndexedBlock,
  cache: LayoutCache,
  block: Extract<Block, { type: "table" }>,
  left: number,
  top: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const blockPath = indexedBlock.path;
  const { cellWidth, columnWidth } = resolveTableColumnMetrics(block, left, options);
  const tableCellRows = indexedBlock.kind === "cells" ? indexedBlock.tableCellRows : [];
  const typography = resolveBlockTypography(block, options.fontSize, options.lineHeight);

  let y = top;

  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
    const rowTop = y;
    const cells = (tableCellRows[rowIndex] ?? []).map((cell) => {
      const input = tableCellLayoutTextInput(cell);
      const cellLeft = left + cell.cellIndex * columnWidth;

      return {
        cellLeft,
        lines: layoutTextContainerLines(cache, input, cellWidth, typography, resources, {
          blockPath,
          contentInset: 0,
          left: cellLeft + TABLE_CELL_PADDING_X,
          top: rowTop + TABLE_CELL_PADDING_Y,
        }),
        path: input.path,
      };
    });
    const rowHeight = resolveTableRowHeight(
      options.lineHeight,
      cells.map((cell) => sumLineHeights(cell.lines)),
    );

    for (const cell of cells) {
      for (const line of cell.lines) {
        lines.push(line);
        mergeLayoutBlockExtent(blockExtents, blockPath, line.top, line.top + line.height);
      }

      pathBounds.set(cell.path, {
        bottom: y + rowHeight,
        left: cell.cellLeft,
        right: cell.cellLeft + columnWidth,
        top: y,
      });
    }

    mergeLayoutBlockExtent(blockExtents, blockPath, y, y + rowHeight);
    y += rowHeight;
  }

  return y;
}

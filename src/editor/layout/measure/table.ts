// Owns exact table layout. Tables share row bands across multiple text paths,
// so they need a dedicated pass instead of single-path flow.

import type { Block } from "@/document";
import type { DocumentResources } from "@/types";
import type { IndexedBlock, IndexedTableCell } from "../../state";
import type { DocumentLayoutOptions } from "../lib/options";
import { mergeLayoutBlockExtent, type LayoutBlockExtent } from "../lib/marker-metrics";
import { updateBlockExtent, type DocumentLayout, type LayoutLine } from "./index";
import {
  measureTextContainerLines,
  measureTextLineBoundaries,
  resolveBlockTypography,
  type BlockTypography,
  type MeasuredTextLine,
} from "./text";
import { tableCellLayoutTextInput } from "./text-input";
import type { LayoutCache } from "../state/cache";

type MeasuredTableRowCell = {
  cellIndex: number;
  input: ReturnType<typeof tableCellLayoutTextInput>;
  typography: BlockTypography;
  measuredLines: MeasuredTextLine[];
};

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
  return Math.max(
    lineHeight + TABLE_CELL_PADDING_Y * 2,
    ...cellContentHeights.map((height) => height + TABLE_CELL_PADDING_Y * 2),
  );
}

export function layoutTable(
  lines: LayoutLine[],
  blockExtents: Map<string, LayoutBlockExtent>,
  pathBounds: DocumentLayout["pathBounds"],
  indexedBlock: IndexedBlock,
  cache: LayoutCache,
  block: Extract<Block, { type: "table" }>,
  blockPath: string,
  left: number,
  top: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const { cellWidth, columnWidth } = resolveTableColumnMetrics(block, left, options);
  const tableCellRows = indexedBlock.kind === "cells" ? indexedBlock.tableCellRows : [];

  let y = top;

  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
    const measuredCells = measureTableRowCells(
      tableCellRows[rowIndex] ?? [],
      cache,
      block,
      cellWidth,
      options.lineHeight,
      options.fontSize,
      resources,
    );
    const rowHeight = resolveTableRowHeight(
      options.lineHeight,
      measuredCells.map((entry) =>
        entry.measuredLines.reduce((total, line) => total + line.height, 0),
      ),
    );

    for (const cell of measuredCells) {
      const cellLeft = left + cell.cellIndex * columnWidth;
      let lineTop = y + TABLE_CELL_PADDING_Y;

      for (const line of cell.measuredLines) {
        const layoutLine = {
          blockPath,
          path: cell.input.path,
          start: line.start,
          end: line.end,
          top: lineTop,
          left: cellLeft + TABLE_CELL_PADDING_X,
          width: line.width,
          height: line.height,
          contentInset: 0,
          text: line.text,
          font: cell.typography.font,
          inlineReferences: line.inlineReferences,
          boundaries: measureTextLineBoundaries(
            cache,
            cell.input,
            line.start,
            line.end,
            line.text,
            cellWidth,
            cell.typography,
            resources,
          ),
        } satisfies LayoutLine;

        lines.push(layoutLine);
        updateBlockExtent(blockExtents, layoutLine);
        lineTop += line.height;
      }

      pathBounds.set(cell.input.path, {
        bottom: y + rowHeight,
        left: cellLeft,
        right: cellLeft + columnWidth,
        top: y,
      });
    }

    mergeLayoutBlockExtent(blockExtents, blockPath, y, y + rowHeight);
    y += rowHeight;
  }

  return y;
}

function measureTableRowCells(
  cells: readonly IndexedTableCell[],
  cache: LayoutCache,
  block: Extract<Block, { type: "table" }>,
  cellWidth: number,
  fallbackLineHeight: number,
  baseFontSize: number,
  resources: DocumentResources,
) {
  const typography = resolveBlockTypography(block, baseFontSize, fallbackLineHeight);

  return cells.map<MeasuredTableRowCell>((cell) => {
    const input = tableCellLayoutTextInput(cell);
    const measuredLines = measureTextContainerLines(
      cache,
      input,
      block,
      cellWidth,
      typography,
      resources,
    );

    return {
      cellIndex: cell.cellIndex,
      input,
      typography,
      measuredLines,
    };
  });
}

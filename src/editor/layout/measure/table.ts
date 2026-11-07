// Owns exact table layout. Tables share row bands across multiple text paths,
// so they need a dedicated pass instead of single-path flow.

import { getTableColumnCount, type Block } from "@/document";
import type { DocumentResources } from "@/editor/resources";
import type { IndexedBlock } from "../../state";
import type { DocumentLayoutOptions } from "../lib/options";
import { mergeLayoutBlockExtent, type LayoutBlockExtent } from "../lib/marker-metrics";
import type { DocumentLayout, LayoutLine } from "./index";
import { layoutTextContainerLines, resolveBlockTypography, sumLineHeights } from "./text";
import { tableCellLayoutTextInput } from "./text-input";
import type { LayoutCache } from "../state/cache";

export const TABLE_CELL_PADDING_X = 10;
export const TABLE_CELL_PADDING_Y = 8;
export const TABLE_MIN_WIDTH = 120;

export function resolveTableColumnMetrics(
  block: Extract<Block, { type: "table" }>,
  left: number,
  options: DocumentLayoutOptions,
) {
  const tableWidth = Math.max(TABLE_MIN_WIDTH, options.width - left - options.paddingX);
  const columnWidth = tableWidth / getTableColumnCount(block);

  return {
    cellWidth: Math.max(40, columnWidth - TABLE_CELL_PADDING_X * 2),
    columnWidth,
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
  left: number,
  top: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const { block, path: blockPath } = indexedBlock;

  if (block.type !== "table" || indexedBlock.kind !== "cells") {
    return top;
  }

  const { cellWidth, columnWidth } = resolveTableColumnMetrics(block, left, options);
  const typography = resolveBlockTypography(block, options.fontSize, options.lineHeight);

  let y = top;

  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
    const rowTop = y;
    const cells = (indexedBlock.tableCellRows[rowIndex] ?? []).map((cell) => {
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

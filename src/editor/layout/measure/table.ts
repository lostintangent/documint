// Owns exact table layout. Tables share row bands across multiple text
// regions, so they need a dedicated pass instead of single-region flow.

import type { Block } from "@/document";
import type { DocumentResources } from "@/types";
import type { DocumentIndex } from "../../state";
import type { DocumentLayoutOptions } from "../lib/options";
import type { LayoutBlockExtent } from "../lib/marker-metrics";
import { updateBlockExtent, type DocumentLayout, type LayoutLine } from "./index";
import {
  measureTextContainerLines,
  measureTextLineBoundaries,
  resolveBlockTypography,
  type BlockTypography,
} from "./text";
import type { LayoutCache } from "../state/cache";

type TableRowCell = {
  cellIndex: number;
  container: DocumentIndex["regions"][number];
};

type MeasuredTableRowCell = TableRowCell & {
  typography: BlockTypography;
  measuredLines: Array<{
    end: number;
    height: number;
    inlineReferences: LayoutLine["inlineReferences"];
    start: number;
    text: string;
    width: number;
  }>;
};

export const TABLE_CELL_PADDING_X = 10;
export const TABLE_CELL_PADDING_Y = 8;
export const TABLE_MIN_WIDTH = 120;

export function layoutTable(
  lines: LayoutLine[],
  blockExtents: Map<string, LayoutBlockExtent>,
  regionBounds: DocumentLayout["regionBounds"],
  regions: DocumentIndex["regions"],
  cache: LayoutCache,
  block: Extract<Block, { type: "table" }>,
  left: number,
  top: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const columnCount = Math.max(1, ...block.rows.map((row) => row.cells.length));
  const tableWidth = Math.max(TABLE_MIN_WIDTH, options.width - left - options.paddingX);
  const columnWidth = tableWidth / columnCount;
  const rowCells = collectTableRowCells(regions);

  let y = top;

  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
    const measuredCells = measureTableRowCells(
      rowCells.get(rowIndex) ?? [],
      cache,
      block,
      columnWidth,
      TABLE_CELL_PADDING_X,
      options.lineHeight,
      options.fontSize,
      resources,
    );
    const rowHeight = Math.max(
      options.lineHeight + TABLE_CELL_PADDING_Y * 2,
      ...measuredCells.map(
        (entry) =>
          entry.measuredLines.reduce((total, line) => total + line.height, 0) +
          TABLE_CELL_PADDING_Y * 2,
      ),
    );

    for (const cell of measuredCells) {
      const cellLeft = left + cell.cellIndex * columnWidth;
      let lineTop = y + TABLE_CELL_PADDING_Y;

      for (const line of cell.measuredLines) {
        const layoutLine = {
          blockId: cell.container.block.id,
          regionId: cell.container.id,
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
            cell.container,
            line.start,
            line.end,
            line.text,
            columnWidth - TABLE_CELL_PADDING_X * 2,
            cell.typography,
            resources,
          ),
        } satisfies LayoutLine;

        lines.push(layoutLine);
        updateBlockExtent(blockExtents, layoutLine);
        lineTop += line.height;
      }

      regionBounds.set(cell.container.id, {
        bottom: y + rowHeight,
        left: cellLeft,
        right: cellLeft + columnWidth,
        top: y,
      });
    }

    updateBlockExtentBounds(blockExtents, block.id, y, y + rowHeight);
    y += rowHeight;
  }

  return y;
}

function collectTableRowCells(regions: DocumentIndex["regions"]) {
  const rows = new Map<number, TableRowCell[]>();

  for (const container of regions) {
    const position = container.tableCellPosition;

    if (!position) {
      continue;
    }

    const current = rows.get(position.rowIndex) ?? [];
    current.push({
      cellIndex: position.cellIndex,
      container,
    });
    rows.set(position.rowIndex, current);
  }

  return rows;
}

function measureTableRowCells(
  cells: TableRowCell[],
  cache: LayoutCache,
  block: Extract<Block, { type: "table" }>,
  columnWidth: number,
  TABLE_CELL_PADDING_X: number,
  fallbackLineHeight: number,
  baseFontSize: number,
  resources: DocumentResources,
) {
  return [...cells]
    .sort((leftCell, rightCell) => leftCell.cellIndex - rightCell.cellIndex)
    .map<MeasuredTableRowCell>(({ cellIndex, container }) => {
      const typography = resolveBlockTypography(block, baseFontSize, fallbackLineHeight);
      const measuredLines = measureTextContainerLines(
        cache,
        container,
        block,
        Math.max(40, columnWidth - TABLE_CELL_PADDING_X * 2),
        typography,
        resources,
      );

      return {
        cellIndex,
        container,
        typography,
        measuredLines,
      };
    });
}

function updateBlockExtentBounds(
  blockExtents: Map<string, LayoutBlockExtent>,
  blockId: string,
  top: number,
  bottom: number,
) {
  const current = blockExtents.get(blockId);

  blockExtents.set(blockId, {
    bottom: current ? Math.max(current.bottom, bottom) : bottom,
    top: current ? Math.min(current.top, top) : top,
  });
}

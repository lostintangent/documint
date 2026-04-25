import type { Block } from "@/document";
import type { DocumentResources } from "@/types";
import type { DocumentIndex } from "../state";
import {
  updateBlockExtent,
  type ViewportLayout,
  type ViewportLayoutLine,
  type DocumentLayoutOptions,
  type LayoutBlockExtent,
} from "./document";
import {
  measureTextContainerLines,
  measureTextLineBoundaries,
  resolveTextBlockFont,
  resolveTextBlockLineHeight,
} from "./text";
import type { CanvasRenderCache } from "../canvas/cache";

type TableRowCell = {
  cellIndex: number;
  container: DocumentIndex["regions"][number];
};

type MeasuredTableRowCell = TableRowCell & {
  font: string;
  lineHeight: number;
  measuredLines: Array<{
    end: number;
    height: number;
    start: number;
    text: string;
    width: number;
  }>;
};

export const TABLE_CELL_PADDING_X = 10;
export const TABLE_CELL_PADDING_Y = 8;
export const TABLE_MIN_WIDTH = 120;

// Table-specific layout geometry. Tables are the one block type whose lines
// share row bands across multiple regions, so they need a dedicated layout
// pass instead of the default single-container flow.
export function layoutTable(
  lines: ViewportLayoutLine[],
  blockExtents: Map<string, LayoutBlockExtent>,
  regionBounds: ViewportLayout["regionBounds"],
  regions: DocumentIndex["regions"],
  cache: CanvasRenderCache,
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
          blockId: cell.container.blockId,
          boundaries: measureTextLineBoundaries(
            cache,
            cell.container,
            line.start,
            line.end,
            line.text,
            cell.font,
            columnWidth - TABLE_CELL_PADDING_X * 2,
            resources,
          ),
          regionId: cell.container.id,
          end: line.end,
          font: cell.font,
          height: line.height,
          left: cellLeft + TABLE_CELL_PADDING_X,
          start: line.start,
          text: line.text,
          top: lineTop,
          width: line.width,
        } satisfies ViewportLayoutLine;

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

  return y + options.blockGap;
}

function collectTableRowCells(regions: DocumentIndex["regions"]) {
  const rows = new Map<number, TableRowCell[]>();

  for (const container of regions) {
    const position = parseTableCellPath(container.path);

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
  cache: CanvasRenderCache,
  block: Extract<Block, { type: "table" }>,
  columnWidth: number,
  TABLE_CELL_PADDING_X: number,
  fallbackLineHeight: number,
  resources: DocumentResources,
) {
  return [...cells]
    .sort((leftCell, rightCell) => leftCell.cellIndex - rightCell.cellIndex)
    .map<MeasuredTableRowCell>(({ cellIndex, container }) => {
      const font = resolveTextBlockFont(block);
      const lineHeight = resolveTextBlockLineHeight(block, fallbackLineHeight);
      const measuredLines = measureTextContainerLines(
        cache,
        container,
        font,
        block,
        Math.max(40, columnWidth - TABLE_CELL_PADDING_X * 2),
        lineHeight,
        resources,
      );

      return {
        cellIndex,
        container,
        font,
        lineHeight,
        measuredLines,
      };
    });
}

function parseTableCellPath(path: string) {
  const match = /\.rows\.(\d+)\.cells\.(\d+)$/.exec(path);

  if (!match) {
    return null;
  }

  return {
    cellIndex: Number(match[2]),
    rowIndex: Number(match[1]),
  };
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

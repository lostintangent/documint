import type { Block } from "@/document";
import type { DocumentResources } from "../resources";
import type {
  DocumentEditor,
} from "../model/document-editor";
import type {
  ViewportLayout,
  ViewportLayoutLine,
  DocumentLayoutOptions,
  LayoutBlockExtent,
} from "./document";
import {
  measureTextContainerLines,
  measureTextLineBoundaries,
  resolveTextBlockFont,
  resolveTextBlockLineHeight,
} from "./text";
import type { CanvasRenderCache } from "../render/cache";

type TableRowCell = {
  cellIndex: number;
  container: DocumentEditor["regions"][number];
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

// Table-specific layout geometry. Tables are the one block type whose lines
// share row bands across multiple regions, so they need a dedicated layout
// pass instead of the default single-container flow.
export function layoutTable(
  lines: ViewportLayoutLine[],
  blockExtents: Map<string, LayoutBlockExtent>,
  regionExtents: ViewportLayout["regionExtents"],
  regions: DocumentEditor["regions"],
  cache: CanvasRenderCache,
  block: Extract<Block, { type: "table" }>,
  left: number,
  top: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const columnCount = Math.max(1, ...block.rows.map((row) => row.cells.length));
  const tableWidth = Math.max(120, options.width - left - options.paddingX);
  const columnWidth = tableWidth / columnCount;
  const cellPaddingX = 10;
  const cellPaddingY = 8;
  const rowCells = collectTableRowCells(regions);

  let y = top;

  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
    const measuredCells = measureTableRowCells(
      rowCells.get(rowIndex) ?? [],
      cache,
      block,
      columnWidth,
      cellPaddingX,
      options.lineHeight,
      resources,
    );
    const rowHeight = Math.max(
      options.lineHeight + cellPaddingY * 2,
      ...measuredCells.map(
        (entry) => entry.measuredLines.reduce((total, line) => total + line.height, 0) + cellPaddingY * 2,
      ),
    );

    for (const cell of measuredCells) {
      const cellLeft = left + cell.cellIndex * columnWidth;
      let lineTop = y + cellPaddingY;

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
            columnWidth - cellPaddingX * 2,
            resources,
          ),
          regionId: cell.container.id,
          end: line.end,
          font: cell.font,
          height: line.height,
          left: cellLeft + cellPaddingX,
          start: line.start,
          text: line.text,
          top: lineTop,
          width: line.width,
        } satisfies ViewportLayoutLine;

        lines.push(layoutLine);
        updateBlockExtent(blockExtents, layoutLine);
        lineTop += line.height;
      }

      regionExtents.set(cell.container.id, {
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

function collectTableRowCells(regions: DocumentEditor["regions"]) {
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
  cellPaddingX: number,
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
        Math.max(40, columnWidth - cellPaddingX * 2),
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

function updateBlockExtent(
  blockExtents: Map<string, LayoutBlockExtent>,
  line: Pick<ViewportLayoutLine, "blockId" | "height" | "top">,
) {
  const current = blockExtents.get(line.blockId);
  const nextBottom = line.top + line.height;

  blockExtents.set(line.blockId, {
    bottom: current ? Math.max(current.bottom, nextBottom) : nextBottom,
    top: current ? Math.min(current.top, line.top) : line.top,
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

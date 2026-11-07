// Owns visible line, block, and table row range queries over a prepared
// `DocumentLayout`.

import { findInterleavedVerticalRange, findVerticalRange } from "../lib/vertical-range";
import type { DocumentLayout, LayoutBlock, LayoutLine } from "../measure";
import type { EditorLayoutState } from "../state";

export function findDocumentLayoutBlockRange(layout: DocumentLayout, top: number, height: number) {
  return findVerticalRange(layout.blocks, top, top + height, blockTop, blockBottom);
}

export function findDocumentLayoutLineRange(layout: DocumentLayout, top: number, height: number) {
  return findInterleavedVerticalRange(
    layout.lines,
    top,
    top + height,
    layout.maxLineHeight,
    lineTop,
    lineBottom,
  );
}

// Every cell of a row shares the row's bounds, so a row's first cell places it.
export function findDocumentLayoutTableRowRange(
  layout: DocumentLayout,
  rows: TableRows,
  top: number,
  height: number,
) {
  return findVerticalRange(
    rows,
    top,
    top + height,
    (_row, rowIndex) => tableRowEdge(layout, rows, rowIndex, "top"),
    (_row, rowIndex) => tableRowEdge(layout, rows, rowIndex, "bottom"),
  );
}

export function someVisibleDocumentLayoutLine(
  viewport: EditorLayoutState,
  predicate: (line: LayoutLine, lineIndex: number) => boolean,
): boolean {
  const { layout } = viewport;
  const { height, top } = viewport.viewport;
  const { endIndex, startIndex } = findDocumentLayoutLineRange(layout, top, height);

  for (let lineIndex = startIndex; lineIndex < endIndex; lineIndex += 1) {
    const line = layout.lines[lineIndex]!;

    // Every line in the range starts above the window bottom, but the cells of
    // a table row can put lines that end above the window top inside it.
    if (lineBottom(line) > top && predicate(line, lineIndex)) {
      return true;
    }
  }

  return false;
}

type TableRows = readonly (readonly { path: string }[])[];

// A row without cells has no bounds, so it collapses onto the bottom of the
// nearest row above it. That keeps row edges in order without giving it extent.
function tableRowEdge(
  layout: DocumentLayout,
  rows: TableRows,
  rowIndex: number,
  edge: "bottom" | "top",
) {
  for (let index = rowIndex; index >= 0; index -= 1) {
    const cell = rows[index]![0];
    const bounds = cell ? layout.pathBounds.get(cell.path) : undefined;

    if (bounds) {
      return index === rowIndex ? bounds[edge] : bounds.bottom;
    }
  }

  return -Infinity;
}

const blockTop = (block: LayoutBlock) => block.top;
const blockBottom = (block: LayoutBlock) => block.bottom;
const lineTop = (line: LayoutLine) => line.top;
const lineBottom = (line: LayoutLine) => line.top + line.height;

// Owns table-specific surface chrome in the canvas paint path. The main paint
// module delegates here so generic line traversal stays focused on document
// flow while table cells keep their own layering policy.

import type { ViewportLayout } from "../layout";
import type { EditorState } from "../model/state";
import {
  resolveActiveBlockFlashColor,
  type ActiveBlockFlash,
} from "./animations";
import type { EditorTheme } from "./theme";

const tableCellMinimumPaintWidth = 80;

export type PaintRegionExtent = ViewportLayout["regionExtents"] extends Map<string, infer Extent>
  ? Extent
  : never;

type TableCellPaintRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function paintTableCellChrome({
  context,
  containerExtent,
  isHeaderRow,
  lineHeight,
  theme,
}: {
  context: CanvasRenderingContext2D;
  containerExtent: PaintRegionExtent;
  isHeaderRow: boolean;
  lineHeight: number;
  theme: EditorTheme;
}) {
  const cellRect = resolveTableCellPaintRect(containerExtent, lineHeight);

  context.fillStyle = isHeaderRow ? theme.tableHeaderBackground : theme.tableBodyBackground;
  context.fillRect(cellRect.left, cellRect.top, cellRect.width, cellRect.height);
  paintTableCellBorder(context, cellRect, theme);
}

export function paintActiveTableCellHighlightPass({
  activeBlockFlashes,
  activeBlockId,
  activeRegionId,
  context,
  editorState,
  endIndex,
  layout,
  regionExtents,
  startIndex,
  theme,
  verticalBleed,
}: {
  activeBlockFlashes: Map<string, ActiveBlockFlash>;
  activeBlockId: string | null;
  activeRegionId: string | null;
  context: CanvasRenderingContext2D;
  editorState: EditorState;
  endIndex: number;
  layout: ViewportLayout;
  regionExtents: Map<string, PaintRegionExtent>;
  startIndex: number;
  theme: EditorTheme;
  verticalBleed: number;
}) {
  if (!activeBlockId || !activeRegionId) {
    return;
  }

  const activeTableBlock = editorState.documentEditor.blockIndex.get(activeBlockId) ?? null;

  if (activeTableBlock?.type !== "table") {
    return;
  }

  const activeTableCellRegion = editorState.documentEditor.regionIndex.get(activeRegionId) ?? null;

  if (activeTableCellRegion?.blockId !== activeBlockId) {
    return;
  }

  const activeTableCellExtent = regionExtents.get(activeRegionId) ?? null;
  const activeTableCellLineIndices = layout.regionLineIndices.get(activeRegionId) ?? null;

  if (!activeTableCellExtent || !activeTableCellLineIndices || activeTableCellLineIndices.length === 0) {
    return;
  }

  const firstVisibleTableCellLine = layout.lines[activeTableCellLineIndices[0]!] ?? null;

  if (!firstVisibleTableCellLine) {
    return;
  }

  const activeTableCellRect = resolveTableCellPaintRect(
    activeTableCellExtent,
    firstVisibleTableCellLine.height,
  );

  if (activeTableCellRect.width === 0) {
    return;
  }

  const paintedHighlight = paintVisibleTableCellBand({
    context,
    endIndex,
    fillStyle: theme.activeBlockBackground,
    layout,
    left: activeTableCellRect.left,
    lineIndices: activeTableCellLineIndices,
    startIndex,
    verticalBleed,
    width: activeTableCellRect.width,
  });
  const activeTableFlash = activeTableBlock.path
    ? activeBlockFlashes.get(activeTableBlock.path) ?? null
    : null;

  if (activeTableFlash) {
    paintVisibleTableCellBand({
      context,
      endIndex,
      fillStyle: resolveActiveBlockFlashColor(theme.activeBlockFlash, activeTableFlash),
      layout,
      left: activeTableCellRect.left,
      lineIndices: activeTableCellLineIndices,
      startIndex,
      verticalBleed,
      width: activeTableCellRect.width,
    });
  }

  if (!paintedHighlight) {
    return;
  }

  paintTableCellBorder(context, activeTableCellRect, theme);
}

function paintVisibleTableCellBand({
  context,
  endIndex,
  fillStyle,
  layout,
  left,
  lineIndices,
  startIndex,
  verticalBleed,
  width,
}: {
  context: CanvasRenderingContext2D;
  endIndex: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  layout: ViewportLayout;
  left: number;
  lineIndices: number[];
  startIndex: number;
  verticalBleed: number;
  width: number;
}) {
  context.fillStyle = fillStyle;
  let painted = false;

  for (const lineIndex of lineIndices) {
    if (lineIndex < startIndex) {
      continue;
    }

    if (lineIndex >= endIndex) {
      break;
    }

    const line = layout.lines[lineIndex]!;
    context.fillRect(left, line.top - verticalBleed, width, line.height);
    painted = true;
  }

  return painted;
}

function resolveTableCellPaintRect(
  containerExtent: PaintRegionExtent,
  lineHeight: number,
): TableCellPaintRect {
  return {
    height: Math.max(containerExtent.bottom - containerExtent.top, lineHeight),
    left: containerExtent.left,
    top: containerExtent.top,
    width: Math.max(containerExtent.right - containerExtent.left, tableCellMinimumPaintWidth),
  };
}

function paintTableCellBorder(
  context: CanvasRenderingContext2D,
  cellRect: TableCellPaintRect,
  theme: EditorTheme,
) {
  context.strokeStyle = theme.tableBorder;
  context.strokeRect(cellRect.left, cellRect.top, cellRect.width, cellRect.height);
}

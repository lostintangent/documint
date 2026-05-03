// Owns table-specific surface chrome in the canvas paint path. The main paint
// module delegates here so generic line traversal stays focused on document
// flow while table cells keep their own layering policy.

import type { DocumentLayout } from "../../layout";
import type { EditorState } from "../../state";
import { resolveActiveBlockFlashColor, type ActiveBlockFlash } from "../lib/animations";
import type { EditorTheme } from "@/types";

const tableCellMinimumPaintWidth = 80;

export type PaintRegionBounds =
  DocumentLayout["regionBounds"] extends Map<string, infer Extent> ? Extent : never;

type TableCellPaintRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function paintTableCellChrome({
  context,
  containerBounds,
  isHeaderRow,
  lineHeight,
  theme,
}: {
  context: CanvasRenderingContext2D;
  containerBounds: PaintRegionBounds;
  isHeaderRow: boolean;
  lineHeight: number;
  theme: EditorTheme;
}) {
  const cellRect = resolveTableCellPaintRect(containerBounds, lineHeight);

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
  regionBounds,
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
  layout: DocumentLayout;
  regionBounds: Map<string, PaintRegionBounds>;
  startIndex: number;
  theme: EditorTheme;
  verticalBleed: number;
}) {
  if (!activeBlockId || !activeRegionId) {
    return;
  }

  const activeTableBlock = editorState.documentIndex.blockIndex.get(activeBlockId) ?? null;

  if (activeTableBlock?.type !== "table") {
    return;
  }

  const activeTableCellRegion = editorState.documentIndex.regionIndex.get(activeRegionId) ?? null;

  if (activeTableCellRegion?.blockId !== activeBlockId) {
    return;
  }

  const activeTableCellBounds = regionBounds.get(activeRegionId) ?? null;
  const activeTableCellLineIndices = layout.regionLineIndices.get(activeRegionId) ?? null;

  if (
    !activeTableCellBounds ||
    !activeTableCellLineIndices ||
    activeTableCellLineIndices.length === 0
  ) {
    return;
  }

  const firstVisibleTableCellLine = layout.lines[activeTableCellLineIndices[0]!] ?? null;

  if (!firstVisibleTableCellLine) {
    return;
  }

  const activeTableCellRect = resolveTableCellPaintRect(
    activeTableCellBounds,
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
    ? (activeBlockFlashes.get(activeTableBlock.path) ?? null)
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
  layout: DocumentLayout;
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
  containerBounds: PaintRegionBounds,
  lineHeight: number,
): TableCellPaintRect {
  return {
    height: Math.max(containerBounds.bottom - containerBounds.top, lineHeight),
    left: containerBounds.left,
    top: containerBounds.top,
    width: Math.max(containerBounds.right - containerBounds.left, tableCellMinimumPaintWidth),
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

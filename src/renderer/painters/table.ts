// Owns table-specific surface chrome in the canvas paint path. The block
// chrome family delegates here so generic line traversal stays focused on
// document flow while table cells keep their own layering policy. The
// stage-4 dispatcher in `blocks/backgrounds.ts` decides *whether* a table
// cell needs a highlight; this file knows *how* to paint one.

import type { DocumentLayout } from "@/editor/layout";
import type { ResolvedEditorTheme } from "@/types";
import { resolveActiveBlockFlashColor, type ActiveBlockFlash } from "../animations";
import type { PaintRect } from "./geometry";

const tableCellMinimumPaintWidth = 80;

export type PaintRegionBounds =
  DocumentLayout["regionBounds"] extends Map<string, infer Extent> ? Extent : never;

type TableCellPaintRect = PaintRect;

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
  theme: ResolvedEditorTheme;
}) {
  const cellRect = resolveTableCellPaintRect(containerBounds, lineHeight);

  context.fillStyle = isHeaderRow ? theme.tableHeaderBackground : theme.tableBodyBackground;
  context.fillRect(cellRect.left, cellRect.top, cellRect.width, cellRect.height);
  paintTableCellBorder(context, cellRect, theme);
}

// Paints the active-cell highlight band — the colored stripe that follows the
// caret across the visible lines of the active table cell, plus the flash
// overlay when an active-block flash is in flight. Caller is responsible for
// deciding that the active block IS a table cell; this function trusts its
// inputs.
export function paintActiveTableCellHighlight({
  activeFlash,
  activeRegionId,
  context,
  endIndex,
  layout,
  regionBounds,
  startIndex,
  theme,
  verticalBleed,
}: {
  activeFlash: ActiveBlockFlash | null;
  activeRegionId: string;
  context: CanvasRenderingContext2D;
  endIndex: number;
  layout: DocumentLayout;
  regionBounds: Map<string, PaintRegionBounds>;
  startIndex: number;
  theme: ResolvedEditorTheme;
  verticalBleed: number;
}) {
  const cellBounds = regionBounds.get(activeRegionId) ?? null;
  const cellLineIndices = layout.regionLineIndices.get(activeRegionId) ?? null;

  if (!cellBounds || !cellLineIndices || cellLineIndices.length === 0) {
    return;
  }

  const firstVisibleCellLine = layout.lines[cellLineIndices[0]!] ?? null;

  if (!firstVisibleCellLine) {
    return;
  }

  const cellRect = resolveTableCellPaintRect(cellBounds, firstVisibleCellLine.height);

  if (cellRect.width === 0) {
    return;
  }

  const paintedHighlight = paintVisibleTableCellBand({
    context,
    endIndex,
    fillStyle: theme.activeBlockBackground,
    layout,
    left: cellRect.left,
    lineIndices: cellLineIndices,
    startIndex,
    verticalBleed,
    width: cellRect.width,
  });

  if (activeFlash) {
    paintVisibleTableCellBand({
      context,
      endIndex,
      fillStyle: resolveActiveBlockFlashColor(theme.activeBlockFlash, activeFlash),
      layout,
      left: cellRect.left,
      lineIndices: cellLineIndices,
      startIndex,
      verticalBleed,
      width: cellRect.width,
    });
  }

  if (!paintedHighlight) {
    return;
  }

  paintTableCellBorder(context, cellRect, theme);
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
  theme: ResolvedEditorTheme,
) {
  context.strokeStyle = theme.tableBorder;
  context.strokeRect(cellRect.left, cellRect.top, cellRect.width, cellRect.height);
}

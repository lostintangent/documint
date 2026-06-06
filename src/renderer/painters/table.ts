import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "@/types";
import { resolveActiveBlockFlashColor } from "../animations";
import type { ActiveTableCellHighlightFrame, TableCellChromeFrame } from "../frame/chrome/table";

export function paintTableCellChrome(
  context: CanvasRenderingContext2D,
  frame: TableCellChromeFrame,
  theme: ResolvedEditorTheme,
) {
  context.fillStyle = frame.isHeaderRow ? theme.tableHeaderBackground : theme.tableBodyBackground;
  paintRect(context, frame.rect);
  paintTableCellBorder(context, frame.rect, theme);
}

export function paintActiveTableCellHighlight(
  context: CanvasRenderingContext2D,
  highlight: ActiveTableCellHighlightFrame,
  theme: ResolvedEditorTheme,
) {
  paintTableCellBands(context, highlight.bands, theme.activeBlockBackground);

  if (highlight.activeFlash) {
    paintTableCellBands(
      context,
      highlight.bands,
      resolveActiveBlockFlashColor(theme.activeBlockFlash, highlight.activeFlash),
    );
  }

  paintTableCellBorder(context, highlight.borderRect, theme);
}

function paintTableCellBands(
  context: CanvasRenderingContext2D,
  bands: readonly LayoutRect[],
  fillStyle: string | CanvasGradient | CanvasPattern,
) {
  context.fillStyle = fillStyle;

  for (const band of bands) {
    paintRect(context, band);
  }
}

function paintTableCellBorder(
  context: CanvasRenderingContext2D,
  cellRect: LayoutRect,
  theme: ResolvedEditorTheme,
) {
  context.strokeStyle = theme.tableBorder;
  context.strokeRect(cellRect.left, cellRect.top, cellRect.width, cellRect.height);
}

function paintRect(context: CanvasRenderingContext2D, rect: LayoutRect) {
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
}

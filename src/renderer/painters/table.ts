import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "@/types";
import type { TableCellChromeFrame } from "../frame/chrome/table";

export function paintTableCellChrome(
  context: CanvasRenderingContext2D,
  frame: TableCellChromeFrame,
  theme: ResolvedEditorTheme,
) {
  context.fillStyle = frame.isHeaderRow ? theme.tableHeaderBackground : theme.tableBodyBackground;
  paintRect(context, frame.rect);
  paintTableCellBorder(context, frame.rect, theme);
}

export function paintTableCellBorder(
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

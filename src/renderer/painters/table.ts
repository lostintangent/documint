import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "@/types";

export function paintGridCellChrome(
  context: CanvasRenderingContext2D,
  rect: LayoutRect,
  isHeader: boolean,
  theme: ResolvedEditorTheme,
) {
  context.fillStyle = isHeader ? theme.tableHeaderBackground : theme.tableBodyBackground;
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
  context.strokeStyle = theme.tableBorder;
  context.strokeRect(rect.left, rect.top, rect.width, rect.height);
}

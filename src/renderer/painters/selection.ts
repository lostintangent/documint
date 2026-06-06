import type { ResolvedEditorTheme } from "@/types";
import type { DocumentFrameLine } from "../frame";

export function paintSelectionHighlight(
  context: CanvasRenderingContext2D,
  lineFrame: DocumentFrameLine,
  theme: ResolvedEditorTheme,
) {
  const highlight = lineFrame.selectionHighlight;

  if (!highlight) {
    return;
  }

  context.fillStyle = theme.selectionBackground;
  context.fillRect(highlight.left, highlight.top, highlight.width, highlight.height);
}

import type { ResolvedEditorTheme } from "../theme";
import type { DocumentFrameLine } from "../frame";

export function paintSelectionHighlight(
  lineFrame: DocumentFrameLine,
  { context, theme }: { context: CanvasRenderingContext2D; theme: ResolvedEditorTheme },
) {
  const highlight = lineFrame.selectionHighlight;

  if (!highlight) {
    return;
  }

  context.fillStyle = theme.selectionBackground;
  context.fillRect(highlight.left, highlight.top, highlight.width, highlight.height);
}

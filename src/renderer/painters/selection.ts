import type { ResolvedEditorTheme } from "../theme";
import type { DocumentFrameLine } from "../frame";
import { paintBlockBackground } from "./blocks/backgrounds";

export function paintSelectionHighlight(
  lineFrame: DocumentFrameLine,
  { context, theme }: { context: CanvasRenderingContext2D; theme: ResolvedEditorTheme },
) {
  const highlight = lineFrame.selectionHighlight;

  paintBlockBackground(
    context,
    highlight && {
      color: theme.selectionBackground,
      opacity: highlight.opacity,
      rect: highlight.rect,
    },
  );
}

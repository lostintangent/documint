// Owns caret painting on the overlay canvas. The user caret is suppressed when
// a range selection exists (the selection highlight on the content canvas
// stands in for it); presence carets always draw.

import type { OverlayCaretFrame } from "../frame";

const caretStrokeWidth = 2;

export function paintCaretOverlay(
  context: CanvasRenderingContext2D,
  carets: readonly OverlayCaretFrame[],
) {
  for (const caret of carets) {
    paintCaret(context, caret);
  }
}

function paintCaret(context: CanvasRenderingContext2D, caret: OverlayCaretFrame) {
  context.fillStyle = caret.color;
  context.fillRect(caret.left, caret.top, caretStrokeWidth, caret.height);
}

import type { DocumentFrameLine } from "../frame";
import { paintAmbientlyPulsing } from "../effects/pulse";

export function paintCommentHighlights(
  context: CanvasRenderingContext2D,
  lineFrame: DocumentFrameLine,
  ambientTime: number,
) {
  for (const highlight of lineFrame.commentHighlights) {
    context.fillStyle = highlight.color;

    if (highlight.pulse) {
      paintAmbientlyPulsing(context, ambientTime, () => {
        paintCommentHighlightRect(context, highlight.rect);
      });
    } else {
      paintCommentHighlightRect(context, highlight.rect);
    }
  }
}

function paintCommentHighlightRect(
  context: CanvasRenderingContext2D,
  rect: { height: number; left: number; top: number; width: number },
) {
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
}

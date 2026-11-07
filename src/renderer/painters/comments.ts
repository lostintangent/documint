import type { DocumentFrameLine } from "../frame";
import { paintAmbientlyPulsing } from "../effects/pulse";

export function paintCommentHighlights(
  lineFrame: DocumentFrameLine,
  { ambientTime, context }: { ambientTime: number; context: CanvasRenderingContext2D },
) {
  for (const { color, pulse, rect } of lineFrame.commentHighlights) {
    context.fillStyle = color;

    if (pulse) {
      paintAmbientlyPulsing(context, ambientTime, () =>
        context.fillRect(rect.left, rect.top, rect.width, rect.height),
      );
    } else {
      context.fillRect(rect.left, rect.top, rect.width, rect.height);
    }
  }
}

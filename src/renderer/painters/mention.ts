// Owns paint policy for user mention segments. Mentions are projected into the
// text stream as replacement segments, then rendered as a pill.

import type { ResolvedEditorTheme } from "../theme";
import type { MentionSegment } from "../frame/line/text-segments";

const mentionCornerRadius = 5;

export function paintMentionSegment(
  context: CanvasRenderingContext2D,
  segment: MentionSegment,
  theme: ResolvedEditorTheme,
) {
  const { rect, textBaseline } = segment.pill;
  const radius = Math.min(mentionCornerRadius, rect.width / 2, rect.height / 2);

  context.fillStyle = theme.mentionBackground;
  context.beginPath();
  context.roundRect(rect.left, rect.top, rect.width, rect.height, radius);
  context.fill();
  context.fillStyle = theme.mentionText;
  context.fillText(`@${segment.mentionName}`, segment.textLeft, textBaseline);
}

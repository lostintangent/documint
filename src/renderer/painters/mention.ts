// Owns paint policy for user mention segments. Mentions are projected into the
// text stream as replacement segments, then rendered as a pill.

import type { ResolvedEditorTheme } from "@/types";
import type { MentionSegment } from "../frame/line/text-segments";
import { paintTextPillBackground } from "./pill";

const mentionCornerRadius = 5;

export function paintMentionSegment(
  context: CanvasRenderingContext2D,
  segment: MentionSegment,
  theme: ResolvedEditorTheme,
) {
  const { pill } = segment;

  context.fillStyle = theme.mentionBackground;
  paintTextPillBackground(
    context,
    pill.rect.left,
    pill.rect.top,
    pill.rect.width,
    pill.rect.height,
    mentionCornerRadius,
  );
  context.fillStyle = theme.mentionText;
  context.fillText(`@${segment.mentionName}`, segment.textLeft, pill.textBaseline);
}

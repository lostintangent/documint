// Inline mention measurement policy. Mentions render as compact pills but
// occupy one object-replacement character in editor text, so layout measures
// the visual pill width for that single atomic offset.

import type { RuntimeMentionAttributes } from "../../state";

export const mentionHorizontalPadding = 4;
export const mentionMinimumWidth = 18;

export function measureInlineMentionWidth(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null,
  mention: RuntimeMentionAttributes,
) {
  if (!context) {
    return Math.max(mentionMinimumWidth, mention.name.length * 8 + mentionHorizontalPadding * 2);
  }

  return Math.max(
    mentionMinimumWidth,
    context.measureText(`@${mention.name}`).width + mentionHorizontalPadding * 2,
  );
}

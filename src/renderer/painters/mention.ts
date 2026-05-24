// Owns paint policy for inline user mentions. Mentions are semantic inline
// objects projected as one replacement character, then rendered as a pill.

import type { ResolvedEditorTheme } from "@/types";
import type { DocumentLayout } from "@/editor/layout";
import type { InlineEntry } from "@/editor/state";
import { mentionHorizontalPadding } from "@/editor/layout/measure/inline-mention";
import { resolveCenteredTextBaseline, resolveFontMetrics } from "@/editor/text/measure";

const mentionCornerRadius = 5;
const mentionVerticalNudge = -1;
const mentionVerticalPadding = 3;
const mentionTextVerticalNudge = 1;

export function paintInlineMention(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  inline: InlineEntry,
  theme: ResolvedEditorTheme,
  left: number,
  right: number,
) {
  if (inline.node.type !== "mention") {
    return;
  }

  const baseline = line.top + resolveCenteredTextBaseline(line.height, context.font);
  const metrics = resolveFontMetrics(context.font);
  const top = baseline - metrics.ascent - mentionVerticalPadding + mentionVerticalNudge;
  const height = metrics.ascent + metrics.descent + mentionVerticalPadding * 2;
  const width = Math.max(0, right - left);

  context.fillStyle = theme.mentionBackground;
  paintRoundedRect(context, left, top, width, height, mentionCornerRadius);
  context.fillStyle = theme.mentionText;
  context.fillText(
    `@${inline.node.name}`,
    left + mentionHorizontalPadding,
    baseline + mentionVerticalNudge + mentionTextVerticalNudge,
  );
}

function paintRoundedRect(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
) {
  const resolvedRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.roundRect(left, top, width, height, resolvedRadius);
  context.fill();
}

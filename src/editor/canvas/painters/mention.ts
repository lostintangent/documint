// Owns paint policy for inline user mentions. Mentions are semantic inline
// objects projected as one replacement character, then rendered as a pill.

import type { EditorTheme } from "@/types";
import type { DocumentLayout } from "../../layout";
import type { EditorInline } from "../../state";
import { mentionHorizontalPadding } from "../../layout/measure/mention";
import { resolveCanvasCenteredTextBaseline, resolveCanvasFontMetrics } from "../lib/fonts";

const mentionCornerRadius = 5;
const mentionVerticalNudge = -1;
const mentionVerticalPadding = 3;
const mentionTextVerticalNudge = 1;

export function paintInlineMention(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  inline: EditorInline,
  theme: EditorTheme,
  left: number,
  right: number,
) {
  if (!inline.mention) {
    return;
  }

  const baseline = line.top + resolveCanvasCenteredTextBaseline(line.height, context.font);
  const metrics = resolveCanvasFontMetrics(context.font);
  const top = baseline - metrics.ascent - mentionVerticalPadding + mentionVerticalNudge;
  const height = metrics.ascent + metrics.descent + mentionVerticalPadding * 2;
  const width = Math.max(0, right - left);

  context.fillStyle = theme.mentionBackground ?? theme.inlineCodeBackground;
  paintRoundedRect(context, left, top, width, height, mentionCornerRadius);
  context.fillStyle = theme.mentionText ?? theme.linkText;
  context.fillText(
    `@${inline.mention.name}`,
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

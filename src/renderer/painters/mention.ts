// Owns paint policy for inline user mentions. Mentions are semantic inline
// objects projected as one replacement character, then rendered as a pill.

import type { ResolvedEditorTheme } from "@/types";
import type { DocumentLayout } from "@/editor/layout";
import type { InlineEntry } from "@/editor/state";
import { mentionHorizontalPadding } from "@/editor/layout/measure/inline-mention";
import { paintInlinePillBackground, resolveInlinePillBox } from "./pill";

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

  const box = resolveInlinePillBox(context, line, left, right, {
    textVerticalNudge: mentionTextVerticalNudge,
    verticalNudge: mentionVerticalNudge,
    verticalPadding: mentionVerticalPadding,
  });

  context.fillStyle = theme.mentionBackground;
  paintInlinePillBackground(context, left, box.top, box.width, box.height, mentionCornerRadius);
  context.fillStyle = theme.mentionText;
  context.fillText(`@${inline.node.name}`, left + mentionHorizontalPadding, box.textBaseline);
}

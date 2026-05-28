// Shared immediate-mode geometry for inline pills. Semantic painters own
// labels, colors, icons, and activity; this helper only resolves the common
// line-relative pill box and paints its rounded background.

import type { DocumentLayout } from "@/editor/layout";
import { resolveCenteredTextBaseline, resolveFontMetrics } from "@/editor/text/measure";

export type InlinePillBox = {
  height: number;
  textBaseline: number;
  top: number;
  width: number;
};

export function resolveInlinePillBox(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  left: number,
  right: number,
  {
    textVerticalNudge,
    verticalNudge,
    verticalPadding,
  }: {
    textVerticalNudge: number;
    verticalNudge: number;
    verticalPadding: number;
  },
): InlinePillBox {
  const baseline = line.top + resolveCenteredTextBaseline(line.height, context.font);
  const metrics = resolveFontMetrics(context.font);

  return {
    height: metrics.ascent + metrics.descent + verticalPadding * 2,
    textBaseline: baseline + verticalNudge + textVerticalNudge,
    top: baseline - metrics.ascent - verticalPadding + verticalNudge,
    width: Math.max(0, right - left),
  };
}

export function paintInlinePillBackground(
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

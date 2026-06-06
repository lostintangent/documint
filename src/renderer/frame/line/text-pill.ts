import type { DocumentLayout, LayoutRect } from "@/editor/layout";
import { resolveCenteredTextBaseline, resolveFontMetrics } from "@/editor/text/measure";

export type TextPillFrame = {
  rect: LayoutRect;
  textBaseline: number;
};

export function resolveTextPillFrame(
  line: DocumentLayout["lines"][number],
  font: string,
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
): TextPillFrame {
  const baseline = line.top + resolveCenteredTextBaseline(line.height, font);
  const metrics = resolveFontMetrics(font);

  return {
    rect: {
      height: metrics.ascent + metrics.descent + verticalPadding * 2,
      left,
      top: baseline - metrics.ascent - verticalPadding + verticalNudge,
      width: Math.max(0, right - left),
    },
    textBaseline: baseline + verticalNudge + textVerticalNudge,
  };
}

import { measureLineOffsetLeft, type DocumentLayout, type LayoutRect } from "@/editor/layout";

export function resolveLineRangeRectFrame(
  line: DocumentLayout["lines"][number],
  startOffset: number,
  endOffset: number,
  {
    minimumWidth,
    top,
    height,
  }: {
    height: number;
    minimumWidth: number;
    top: number;
  },
): LayoutRect {
  const left = measureLineOffsetLeft(line, startOffset - line.start) + line.contentInset;
  const right = measureLineOffsetLeft(line, endOffset - line.start) + line.contentInset;

  return {
    height,
    left,
    top,
    width: Math.max(minimumWidth, right - left),
  };
}

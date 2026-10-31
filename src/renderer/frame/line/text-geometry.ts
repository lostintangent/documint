import { measureLineOffsetLeft, type DocumentLayout, type LayoutRect } from "@/editor/layout";

export function resolveLineSegmentBounds(
  line: DocumentLayout["lines"][number],
  textLeft: number,
  startOffset: number,
  endOffset: number,
) {
  return {
    left: textLeft + (measureLineOffsetLeft(line, startOffset - line.start) - line.left),
    right: textLeft + (measureLineOffsetLeft(line, endOffset - line.start) - line.left),
  };
}

// Selection and comment range rects share text segment x-positions, so their
// edges line up exactly with the glyphs they cover.
export function resolveLineRangeRectFrame(
  line: DocumentLayout["lines"][number],
  startOffset: number,
  endOffset: number,
  { height, minimumWidth, top }: { height: number; minimumWidth: number; top: number },
): LayoutRect {
  const textLeft = line.left + line.contentInset;
  const { left, right } = resolveLineSegmentBounds(line, textLeft, startOffset, endOffset);

  return {
    height,
    left,
    top,
    width: Math.max(minimumWidth, right - left),
  };
}

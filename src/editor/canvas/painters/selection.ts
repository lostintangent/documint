// Owns range-on-line painters: the selection highlight and the comment
// underline. Both walk the same shape — clip a [start, end) document range to
// the visible portion of a line and fill a rectangle in line-local space — so
// they share this file.

import type { EditorCommentRange } from "../../anchors";
import { resolveLineVisualLeft, type DocumentLayout } from "../../layout";
import type { EditorState } from "../../state";
import type { EditorTheme } from "@/types";
import type { CanvasSelectionRange } from "..";

const selectionMinimumWidth = 2;
const selectionVerticalInset = 1;
const selectionVerticalTrim = 2;
const commentHighlightBottomInset = 5;
const commentHighlightMinimumWidth = 2;
const commentHighlightThickness = 3;

export type SelectionRegionOrderRange = {
  end: number;
  start: number;
};

export function resolveSelectionRegionOrderRange(
  editorState: EditorState,
  normalizedSelection: CanvasSelectionRange,
): SelectionRegionOrderRange | null {
  const regionOrderIndex = editorState.documentIndex.regionOrderIndex;
  const start = regionOrderIndex.get(normalizedSelection.start.regionId);
  const end = regionOrderIndex.get(normalizedSelection.end.regionId);

  return start === undefined || end === undefined ? null : { end, start };
}

export function paintSelectionHighlight(
  context: CanvasRenderingContext2D,
  editorState: EditorState,
  line: DocumentLayout["lines"][number],
  normalizedSelection: CanvasSelectionRange,
  selectionRegionOrderRange: SelectionRegionOrderRange | null,
  theme: EditorTheme,
) {
  if (!selectionRegionOrderRange) {
    return;
  }

  const lineRegionOrder = editorState.documentIndex.regionOrderIndex.get(line.regionId);

  if (
    lineRegionOrder === undefined ||
    lineRegionOrder < selectionRegionOrderRange.start ||
    lineRegionOrder > selectionRegionOrderRange.end
  ) {
    return;
  }

  const overlapStart =
    lineRegionOrder === selectionRegionOrderRange.start
      ? Math.max(line.start, normalizedSelection.start.offset)
      : line.start;
  const overlapEnd =
    lineRegionOrder === selectionRegionOrderRange.end
      ? Math.min(line.end, normalizedSelection.end.offset)
      : line.end;

  if (overlapEnd <= overlapStart) {
    return;
  }

  context.fillStyle = theme.selectionBackground;
  context.fillRect(
    resolveLineVisualLeft(editorState, line, overlapStart - line.start),
    line.top + selectionVerticalInset,
    Math.max(
      selectionMinimumWidth,
      resolveLineVisualLeft(editorState, line, overlapEnd - line.start) -
        resolveLineVisualLeft(editorState, line, overlapStart - line.start),
    ),
    line.height - selectionVerticalTrim,
  );
}

export function paintCanvasCommentHighlights(
  context: CanvasRenderingContext2D,
  editorState: EditorState,
  line: DocumentLayout["lines"][number],
  liveCommentRanges: EditorCommentRange[],
  activeThreadIndex: number | null,
  theme: EditorTheme,
) {
  for (const range of liveCommentRanges) {
    if (range.regionId !== line.regionId) {
      continue;
    }

    const overlapStart = Math.max(range.startOffset, line.start);
    const overlapEnd = Math.min(range.endOffset, line.end);

    if (overlapEnd <= overlapStart) {
      continue;
    }

    context.fillStyle = resolveCommentHighlightColor(range, activeThreadIndex, theme);
    context.fillRect(
      resolveLineVisualLeft(editorState, line, overlapStart - line.start),
      line.top + line.height - commentHighlightBottomInset,
      Math.max(
        commentHighlightMinimumWidth,
        resolveLineVisualLeft(editorState, line, overlapEnd - line.start) -
          resolveLineVisualLeft(editorState, line, overlapStart - line.start),
      ),
      commentHighlightThickness,
    );
  }
}

function resolveCommentHighlightColor(
  range: EditorCommentRange,
  activeThreadIndex: number | null,
  theme: EditorTheme,
) {
  if (range.resolved) {
    return range.threadIndex === activeThreadIndex
      ? theme.commentHighlightResolvedActive
      : theme.commentHighlightResolved;
  }

  return range.threadIndex === activeThreadIndex
    ? theme.commentHighlightActive
    : theme.commentHighlight;
}

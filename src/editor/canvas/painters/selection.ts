// Owns range-on-line painters: the selection highlight and the comment
// underline. Both walk the same shape — clip a [start, end) document range to
// the visible portion of a line and fill a rectangle in line-local space — so
// they share this file.

import type { EditorCommentRange } from "../../anchors";
import { resolveLineVisualLeft, type DocumentLayout } from "../../layout";
import type { EditorState, NormalizedEditorSelection } from "../../state";
import type { EditorTheme } from "@/types";
import { resolveRestingPulseAlpha, restingPulseMinimumAlpha } from "../lib/pulse";

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
  normalizedSelection: NormalizedEditorSelection,
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
  normalizedSelection: NormalizedEditorSelection,
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

  const { left, width } = resolveLineRangeRect(
    editorState,
    line,
    overlapStart,
    overlapEnd,
    selectionMinimumWidth,
  );

  context.fillStyle = theme.selectionBackground;
  context.fillRect(
    left,
    line.top + selectionVerticalInset,
    width,
    line.height - selectionVerticalTrim,
  );
}

export function paintCommentHighlights(
  context: CanvasRenderingContext2D,
  editorState: EditorState,
  line: DocumentLayout["lines"][number],
  commentRanges: EditorCommentRange[],
  activeThreadIndex: number | null,
  presenceActiveThreadColors: ReadonlyMap<number, string | null>,
  ambientAnimationTime: number,
  theme: EditorTheme,
) {
  for (const range of commentRanges) {
    if (range.regionId !== line.regionId) {
      continue;
    }

    const overlapStart = Math.max(range.startOffset, line.start);
    const overlapEnd = Math.min(range.endOffset, line.end);

    if (overlapEnd <= overlapStart) {
      continue;
    }

    context.fillStyle = resolveCommentHighlightColor(
      range,
      activeThreadIndex,
      presenceActiveThreadColors,
      theme,
    );
    const shouldPulse = !range.resolved && presenceActiveThreadColors.has(range.threadIndex);
    const { left, width } = resolveLineRangeRect(
      editorState,
      line,
      overlapStart,
      overlapEnd,
      commentHighlightMinimumWidth,
    );

    if (shouldPulse) {
      context.save();
      context.globalAlpha *= resolveRestingPulseAlpha(ambientAnimationTime, restingPulseMinimumAlpha);
    }
    context.fillRect(
      left,
      line.top + line.height - commentHighlightBottomInset,
      width,
      commentHighlightThickness,
    );
    if (shouldPulse) {
      context.restore();
    }
  }
}

function resolveLineRangeRect(
  editorState: EditorState,
  line: DocumentLayout["lines"][number],
  startOffset: number,
  endOffset: number,
  minimumWidth: number,
) {
  const left = resolveLineVisualLeft(editorState, line, startOffset - line.start);
  const right = resolveLineVisualLeft(editorState, line, endOffset - line.start);

  return {
    left,
    width: Math.max(minimumWidth, right - left),
  };
}

function resolveCommentHighlightColor(
  range: EditorCommentRange,
  activeThreadIndex: number | null,
  presenceActiveThreadColors: ReadonlyMap<number, string | null>,
  theme: EditorTheme,
) {
  if (range.resolved) {
    return range.threadIndex === activeThreadIndex
      ? theme.commentHighlightResolvedActive
      : theme.commentHighlightResolved;
  }

  return range.threadIndex === activeThreadIndex
    ? theme.commentHighlightActive
    : presenceActiveThreadColors.has(range.threadIndex)
      ? (presenceActiveThreadColors.get(range.threadIndex) ?? theme.leafAccent)
      : theme.commentHighlight;
}

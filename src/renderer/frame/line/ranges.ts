import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { EditorLayoutState, LayoutRect } from "@/editor/layout";
import type { NormalizedEditorSelection } from "@/editor/state";
import type { ResolvedEditorTheme } from "@/types";
import { resolveLineRangeRectFrame } from "../range-frame";
import type { SelectionRegionOrderRange } from "../selection-frame";

const commentHighlightBottomInset = 5;
const commentHighlightMinimumWidth = 2;
const commentHighlightThickness = 3;
const selectionMinimumWidth = 2;
const selectionVerticalInset = 1;
const selectionVerticalTrim = 2;

export type CommentHighlightFrame = {
  color: string;
  pulse: boolean;
  rect: LayoutRect;
};

export function resolveDocumentFrameLineRanges({
  activeThreadIndex,
  commentPresence,
  commentRanges,
  line,
  normalizedSelection,
  regionOrder,
  selectionRegionOrderRange,
  theme,
}: {
  activeThreadIndex: number | null;
  commentPresence: ReadonlyMap<number, EditorPresence> | null;
  commentRanges: EditorCommentRange[] | null;
  line: EditorLayoutState["layout"]["lines"][number];
  normalizedSelection: NormalizedEditorSelection;
  regionOrder: number | null;
  selectionRegionOrderRange: SelectionRegionOrderRange | null;
  theme: ResolvedEditorTheme;
}): {
  commentHighlights: CommentHighlightFrame[];
  selectionHighlight: LayoutRect | null;
} {
  return {
    commentHighlights: resolveCommentHighlightFrames({
      activeThreadIndex,
      commentPresence,
      commentRanges,
      line,
      theme,
    }),
    selectionHighlight: resolveSelectionHighlightFrame({
      line,
      normalizedSelection,
      regionOrder,
      selectionRegionOrderRange,
    }),
  };
}

function resolveSelectionHighlightFrame({
  line,
  normalizedSelection,
  regionOrder,
  selectionRegionOrderRange,
}: {
  line: EditorLayoutState["layout"]["lines"][number];
  normalizedSelection: NormalizedEditorSelection;
  regionOrder: number | null;
  selectionRegionOrderRange: SelectionRegionOrderRange | null;
}): LayoutRect | null {
  if (!selectionRegionOrderRange || regionOrder === null) {
    return null;
  }

  if (
    regionOrder < selectionRegionOrderRange.start ||
    regionOrder > selectionRegionOrderRange.end
  ) {
    return null;
  }

  const overlapStart =
    regionOrder === selectionRegionOrderRange.start
      ? Math.max(line.start, normalizedSelection.start.offset)
      : line.start;
  const overlapEnd =
    regionOrder === selectionRegionOrderRange.end
      ? Math.min(line.end, normalizedSelection.end.offset)
      : line.end;

  if (overlapEnd <= overlapStart) {
    return null;
  }

  return resolveLineRangeRectFrame(line, overlapStart, overlapEnd, {
    height: line.height - selectionVerticalTrim,
    minimumWidth: selectionMinimumWidth,
    top: line.top + selectionVerticalInset,
  });
}

function resolveCommentHighlightFrames({
  activeThreadIndex,
  commentPresence,
  commentRanges,
  line,
  theme,
}: {
  activeThreadIndex: number | null;
  commentPresence: ReadonlyMap<number, EditorPresence> | null;
  commentRanges: EditorCommentRange[] | null;
  line: EditorLayoutState["layout"]["lines"][number];
  theme: ResolvedEditorTheme;
}): CommentHighlightFrame[] {
  if (!commentRanges) {
    return [];
  }

  const highlights: CommentHighlightFrame[] = [];

  for (const range of commentRanges) {
    const overlapStart = Math.max(range.startOffset, line.start);
    const overlapEnd = Math.min(range.endOffset, line.end);

    if (overlapEnd <= overlapStart) {
      continue;
    }

    highlights.push({
      color: resolveCommentHighlightColor(range, activeThreadIndex, commentPresence, theme),
      pulse: !range.resolved && commentPresence?.has(range.threadIndex) === true,
      rect: resolveLineRangeRectFrame(line, overlapStart, overlapEnd, {
        height: commentHighlightThickness,
        minimumWidth: commentHighlightMinimumWidth,
        top: line.top + line.height - commentHighlightBottomInset,
      }),
    });
  }

  return highlights;
}

function resolveCommentHighlightColor(
  range: EditorCommentRange,
  activeThreadIndex: number | null,
  commentPresence: ReadonlyMap<number, EditorPresence> | null,
  theme: ResolvedEditorTheme,
) {
  if (range.resolved) {
    return range.threadIndex === activeThreadIndex
      ? theme.commentHighlightResolvedActive
      : theme.commentHighlightResolved;
  }

  return range.threadIndex === activeThreadIndex
    ? theme.commentHighlightActive
    : commentPresence?.has(range.threadIndex) === true
      ? (commentPresence.get(range.threadIndex)?.color ?? theme.leafAccent)
      : theme.commentHighlight;
}

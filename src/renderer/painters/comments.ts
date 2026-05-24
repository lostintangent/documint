// Owns the comment underline on the content canvas. A comment range
// underlines a [start, end) span on each line it covers; the active thread
// gets a different color, and presence on an unresolved thread adds a
// resting ambient pulse so the underline breathes while another user is in
// the thread. Shared range-on-line geometry with the selection painter
// lives in `line-range.ts`.

import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { DocumentLayout } from "@/editor/layout";
import type { EditorState } from "@/editor/state";
import type { ResolvedEditorTheme } from "@/types";
import { resolveRestingPulseAlpha, restingPulseMinimumAlpha } from "../animations/pulse";
import { resolveLineRangeRect } from "./line-range";

const commentHighlightBottomInset = 5;
const commentHighlightMinimumWidth = 2;
const commentHighlightThickness = 3;

export function paintCommentHighlights(
  context: CanvasRenderingContext2D,
  editorState: EditorState,
  line: DocumentLayout["lines"][number],
  commentRanges: EditorCommentRange[],
  activeThreadIndex: number | null,
  commentPresence: ReadonlyMap<number, EditorPresence>,
  ambientAnimationTime: number,
  theme: ResolvedEditorTheme,
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
      commentPresence,
      theme,
    );
    const shouldPulse = !range.resolved && commentPresence.has(range.threadIndex);
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

function resolveCommentHighlightColor(
  range: EditorCommentRange,
  activeThreadIndex: number | null,
  commentPresence: ReadonlyMap<number, EditorPresence>,
  theme: ResolvedEditorTheme,
) {
  if (range.resolved) {
    return range.threadIndex === activeThreadIndex
      ? theme.commentHighlightResolvedActive
      : theme.commentHighlightResolved;
  }

  return range.threadIndex === activeThreadIndex
    ? theme.commentHighlightActive
    : commentPresence.has(range.threadIndex)
      ? (commentPresence.get(range.threadIndex)?.color ?? theme.leafAccent)
      : theme.commentHighlight;
}

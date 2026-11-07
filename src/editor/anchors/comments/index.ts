/**
 * Editor-side comment threads.
 *
 * Comments themselves live on the semantic `Document` (anchored against text);
 * this module is the bridge between that semantic state and the runtime
 * `EditorState`. It owns three operations:
 *
 *   - Capture: build a thread, and where it matched, from an editor selection.
 *   - Runtime resolution: each snapshot's threads matched to runtime ranges,
 *     carried forward across commits (see `carry.ts`).
 *   - Viewport geometry: resolve a comment range to document-space bounds.
 */

import { captureTextAnchor, createCommentThread, type AnchorMatch } from "@/document";
import { compareEditorPositions, type DocumentIndex, type EditorSelectionRange } from "../../state";
import {
  findLineEntryForPathOffset,
  someVisibleDocumentLayoutLine,
  type EditorLayoutState,
} from "../../layout";
import type { EditorState } from "../../state/types";
import { resolveDocumentRangeForPath } from "../text";
import type { EditorPresence } from "../presence";
import { rangeOverlapsSegment } from "../../text/ranges";
import type { EditorCommentRange } from "./carry";

export {
  carryComments,
  getCommentState,
  type CommentChange,
  type EditorCommentRange,
  type EditorCommentState,
} from "./carry";

// --- Capture ---

// Build a `CommentThread` from the current editor selection, along with the
// match it was captured at. Returns `null` if the body is empty, the
// selection is collapsed, or the selected path isn't an anchorable kind (for
// example, a structural list-item marker).
export function createCommentThreadForSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelectionRange,
  body: string,
) {
  const normalizedBody = body.trim();

  if (normalizedBody.length === 0 || selection.startOffset === selection.endOffset) {
    return null;
  }

  const anchorRange = resolveDocumentRangeForPath(documentIndex, selection.path, {
    endOffset: selection.endOffset,
    startOffset: selection.startOffset,
  });

  if (!anchorRange) {
    return null;
  }

  if (anchorRange.startOffset === anchorRange.endOffset) {
    return null;
  }

  const { anchorContainer, endOffset, startOffset } = anchorRange;
  const match: AnchorMatch = {
    containerKind: anchorContainer.containerKind,
    containerPath: anchorContainer.path,
    endOffset,
    startOffset,
  };

  return {
    match,
    thread: createCommentThread({
      ...captureTextAnchor(anchorContainer, startOffset, endOffset),
      body: normalizedBody,
    }),
  };
}

export function hasActiveCommentHighlightsInViewport(
  viewport: EditorLayoutState,
  ranges: readonly EditorCommentRange[],
  commentPresence: ReadonlyMap<number, EditorPresence>,
) {
  if (ranges.length === 0 || commentPresence.size === 0) {
    return false;
  }

  return someVisibleDocumentLayoutLine(viewport, (line) =>
    ranges.some(
      (range) =>
        !range.resolved &&
        commentPresence.has(range.threadIndex) &&
        range.path === line.path &&
        rangeOverlapsSegment(range, line.start, line.end),
    ),
  );
}

// Return the index (into `Document.comments`) of the comment whose range
// either contains the collapsed caret or overlaps the active (non-collapsed)
// selection. Selections can cross paths, so positions are compared through
// the index's document-flow position comparator.
export function resolveActiveCommentIndex(
  state: EditorState,
  ranges: readonly EditorCommentRange[],
): number | null {
  if (ranges.length === 0) {
    return null;
  }

  const { anchor, focus } = state.selection;
  const cmp = (left: { offset: number; path: string }, right: { offset: number; path: string }) =>
    compareEditorPositions(state.documentIndex, left, right, { unknown: "before" });

  const orientation = cmp(anchor, focus);
  const isCollapsed = orientation === 0;
  const [start, end] = orientation <= 0 ? [anchor, focus] : [focus, anchor];

  for (const range of ranges) {
    const rangeStart = { path: range.path, offset: range.startOffset };
    const rangeEnd = { path: range.path, offset: range.endOffset };

    if (isCollapsed) {
      // Caret-in-range: rangeStart ≤ caret ≤ rangeEnd in document order.
      if (cmp(rangeStart, start) <= 0 && cmp(start, rangeEnd) <= 0) {
        return range.threadIndex;
      }
      continue;
    }

    // Open-interval overlap: max(selStart, rangeStart) < min(selEnd, rangeEnd).
    const overlapStart = cmp(start, rangeStart) >= 0 ? start : rangeStart;
    const overlapEnd = cmp(end, rangeEnd) <= 0 ? end : rangeEnd;
    if (cmp(overlapStart, overlapEnd) < 0) {
      return range.threadIndex;
    }
  }

  return null;
}

export function resolveCommentThreadViewportPosition(
  viewport: EditorLayoutState,
  ranges: readonly EditorCommentRange[],
  threadIndex: number,
): { bottom: number; top: number } | null {
  const range =
    ranges.find((candidate) => {
      return candidate.threadIndex === threadIndex;
    }) ?? null;

  if (!range) {
    return null;
  }

  const startLine = findLineEntryForPathOffset(
    viewport.layout,
    range.path,
    range.startOffset,
  )?.line;
  const endLine = findLineEntryForPathOffset(
    viewport.layout,
    range.path,
    Math.max(range.startOffset, range.endOffset - 1),
  )?.line;

  if (startLine && endLine) {
    return {
      bottom: Math.max(startLine.top + startLine.height, endLine.top + endLine.height),
      top: Math.min(startLine.top, endLine.top),
    };
  }

  return viewport.estimatePathBounds(range.path);
}

/**
 * Editor-side resolution of comment threads.
 *
 * Comments themselves live on the semantic `Document` (anchored against text);
 * this module is the bridge between that semantic state and the runtime
 * `EditorState`. It owns four operations:
 *
 *   - Capture: build a thread from an editor selection.
 *   - Runtime resolution: resolve every persisted thread against the current snapshot
 *     and emit runtime ranges plus repaired thread copies.
 *   - Viewport geometry: resolve a comment range to document-space bounds.
 *   - Edit-time repair: optimistically remap thread anchors during inline
 *     edits so threads stay sticky to their text without a full re-resolve.
 */

import {
  createAnchorFromContainer,
  createCommentThread,
  extractQuoteFromContainer,
  resolveCommentThreadInContainers,
  type AnchorContainer,
  type CommentResolution,
  type CommentThread,
  type TextAnchor,
} from "@/document";
import {
  compareEditorPositions,
  resolveCommentThreadIndicesForRegion,
  resolveRegion,
  type DocumentIndex,
  type EditableRegion,
} from "../../state";
import {
  findLineEntryForRegionOffset,
  someVisibleDocumentLayoutLine,
  type EditorLayoutState,
} from "../../layout";
import type { EditorState } from "../../state/types";
import { createEditorTextAnchorResolver, resolveDocumentRangeForRegion } from "../text";
import type { EditorPresence } from "../presence";
import { remapEditedRange } from "./remap";

// --- Types ---

export type EditorCommentRange = {
  endOffset: number;
  resolution: CommentResolution;
  regionPath: string;
  resolved: boolean;
  startOffset: number;
  threadIndex: number;
};

export type EditorCommentState = {
  ranges: EditorCommentRange[];
  threads: CommentThread[];
};

// --- Capture ---

// Build a `CommentThread` from the current editor selection. Returns
// `null` if the body is empty, the selection is collapsed, or the selected
// region isn't an anchorable kind (e.g. a list-item marker region).
export function createCommentThreadForSelection(
  documentIndex: DocumentIndex,
  selection: {
    endOffset: number;
    regionPath: string;
    startOffset: number;
  },
  body: string,
) {
  const normalizedBody = body.trim();

  if (normalizedBody.length === 0 || selection.startOffset === selection.endOffset) {
    return null;
  }

  const region = resolveRegion(documentIndex, selection.regionPath);
  const anchorRange = region
    ? resolveDocumentRangeForRegion(region, {
        endOffset: selection.endOffset,
        startOffset: selection.startOffset,
      })
    : null;

  if (!anchorRange) {
    return null;
  }

  if (anchorRange.startOffset === anchorRange.endOffset) {
    return null;
  }

  return createCommentThread({
    anchor: createAnchorFromContainer(
      anchorRange.anchorContainer,
      anchorRange.startOffset,
      anchorRange.endOffset,
    ),
    body: normalizedBody,
    quote: extractQuoteFromContainer(
      anchorRange.anchorContainer,
      anchorRange.startOffset,
      anchorRange.endOffset,
    ),
  });
}

// --- Runtime Resolution ---

// Resolve every persisted thread against the current document snapshot and
// emit runtime ranges plus repaired thread copies. Threads whose anchors
// don't resolve are silently dropped from `ranges` while their persisted
// `threads` entry stays untouched, ready to repair when the document
// changes again.
export function getCommentState(state: EditorState): EditorCommentState;
export function getCommentState(documentIndex: DocumentIndex): EditorCommentState;
export function getCommentState(stateOrIndex: EditorState | DocumentIndex): EditorCommentState {
  const documentIndex = "documentIndex" in stateOrIndex ? stateOrIndex.documentIndex : stateOrIndex;
  return resolveCommentStateForThreadIndices(
    documentIndex,
    documentIndex.document.comments.map((_, threadIndex) => threadIndex),
  );
}

function resolveCommentStateForThreadIndices(
  documentIndex: DocumentIndex,
  threadIndices: readonly number[],
): EditorCommentState {
  const textAnchorResolver = createEditorTextAnchorResolver(documentIndex);
  const anchorContainers = textAnchorResolver.listContainers();
  const threads = documentIndex.document.comments;
  let resolvedThreads: CommentThread[] | null = null;
  const ranges: EditorCommentRange[] = [];

  for (const threadIndex of threadIndices) {
    const thread = threads[threadIndex];

    if (!thread) {
      continue;
    }

    const resolution = resolveCommentThreadInContainers(thread, anchorContainers);

    if (!resolution.match) {
      continue;
    }

    const editorRange = textAnchorResolver.resolveEditorRange(resolution.match);

    if (!editorRange) {
      continue;
    }

    if (
      resolution.repair &&
      (!sameTextAnchor(resolution.repair.anchor, thread.anchor) ||
        resolution.repair.quote !== thread.quote)
    ) {
      resolvedThreads ??= [...threads];
      resolvedThreads[threadIndex] = {
        ...thread,
        anchor: resolution.repair.anchor,
        quote: resolution.repair.quote,
      };
    }

    ranges.push({
      endOffset: editorRange.endOffset,
      resolution,
      regionPath: editorRange.runtimeContainer.path,
      resolved: thread.resolvedAt != null,
      startOffset: editorRange.startOffset,
      threadIndex,
    });
  }

  return {
    ranges,
    threads: resolvedThreads ?? threads,
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
        range.regionPath === line.regionPath &&
        range.endOffset > line.start &&
        range.startOffset < line.end,
    ),
  );
}

// Return the index (into `Document.comments`) of the comment whose range
// either contains the collapsed caret or overlaps the active (non-collapsed)
// selection. Selections can cross regions, so positions are compared in
// document order via each region's `regionArrayIndex` field.
export function resolveActiveCommentIndex(
  state: EditorState,
  ranges: readonly EditorCommentRange[],
): number | null {
  if (ranges.length === 0) {
    return null;
  }

  const { anchor, focus } = state.selection;
  const cmp = (
    left: { offset: number; regionPath: string },
    right: { offset: number; regionPath: string },
  ) => compareEditorPositions(state.documentIndex, left, right, { unknown: "before" });

  const orientation = cmp(anchor, focus);
  const isCollapsed = orientation === 0;
  const [start, end] = orientation <= 0 ? [anchor, focus] : [focus, anchor];

  for (const range of ranges) {
    const rangeStart = { regionPath: range.regionPath, offset: range.startOffset };
    const rangeEnd = { regionPath: range.regionPath, offset: range.endOffset };

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

  const startLine = findLineEntryForRegionOffset(
    viewport.layout,
    range.regionPath,
    range.startOffset,
  )?.line;
  const endLine = findLineEntryForRegionOffset(
    viewport.layout,
    range.regionPath,
    Math.max(range.startOffset, range.endOffset - 1),
  )?.line;

  if (startLine && endLine) {
    return {
      bottom: Math.max(startLine.top + startLine.height, endLine.top + endLine.height),
      top: Math.min(startLine.top, endLine.top),
    };
  }

  return viewport.estimateRegionBounds(range.regionPath);
}

// --- Edit-time repair ---

// Optimistically keep comments sticky within an edited region by remapping
// each affected thread's comment range through the splice math. General
// resolution still runs against the next document snapshot via
// `getCommentState`; this fast path just minimizes anchor drift for inline
// edits where prefix/suffix context is about to shift.
export function updateCommentThreadsForRegionEdit(
  documentIndex: DocumentIndex,
  nextDocumentIndex: DocumentIndex,
  region: EditableRegion,
  selectionStart: number,
  selectionEnd: number,
  insertedText: string,
) {
  if (documentIndex.document.comments.length === 0) {
    return nextDocumentIndex.document.comments;
  }

  const threadIndices = resolveCommentThreadIndicesForRegion(documentIndex, region);
  const threadIndexSet = new Set(threadIndices);

  if (threadIndices.length === 0) {
    return nextDocumentIndex.document.comments;
  }

  const currentEditRange = resolveDocumentRangeForRegion(region, {
    endOffset: selectionEnd,
    startOffset: selectionStart,
  });
  const currentContainer: AnchorContainer | null = currentEditRange
    ? {
        ...currentEditRange.anchorContainer,
        containerOrdinal: -1,
        path: region.containerPath,
      }
    : null;
  const nextRegion = resolveRegion(nextDocumentIndex, region.path);
  const nextContainer = nextRegion
    ? resolveDocumentRangeForRegion(nextRegion, {
        endOffset: 0,
        startOffset: 0,
      })?.anchorContainer ?? null
    : null;

  if (!currentEditRange || !currentContainer || !nextContainer) {
    return nextDocumentIndex.document.comments;
  }

  const baseComments = nextDocumentIndex.document.comments;
  let nextComments: CommentThread[] | null = null;

  for (const threadIndex of threadIndexSet) {
    const currentThread = documentIndex.document.comments[threadIndex];
    const nextThread = baseComments[threadIndex];

    if (!currentThread || !nextThread) {
      continue;
    }

    const repairedMatch = resolveCommentThreadInContainers(
      currentThread,
      [currentContainer],
    ).match;

    if (!repairedMatch || repairedMatch.containerPath !== region.containerPath) {
      continue;
    }

    const nextRange = remapEditedRange(
      repairedMatch.startOffset,
      repairedMatch.endOffset,
      currentEditRange.startOffset,
      currentEditRange.endOffset,
      insertedText.length,
    );
    const nextAnchor = createAnchorFromContainer(nextContainer, nextRange.start, nextRange.end);
    const nextQuote = extractQuoteFromContainer(nextContainer, nextRange.start, nextRange.end);

    if (sameTextAnchor(nextAnchor, nextThread.anchor) && nextQuote === nextThread.quote) {
      continue;
    }

    nextComments ??= [...baseComments];
    nextComments[threadIndex] = {
      ...nextThread,
      anchor: nextAnchor,
      quote: nextQuote,
    };
  }

  return nextComments ?? baseComments;
}

function sameTextAnchor(left: TextAnchor, right: TextAnchor) {
  return (
    (left.kind ?? null) === (right.kind ?? null) &&
    (left.prefix ?? null) === (right.prefix ?? null) &&
    (left.suffix ?? null) === (right.suffix ?? null)
  );
}

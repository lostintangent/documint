/**
 * Editor-side projection of comment threads.
 *
 * Comments themselves live on the semantic `Document` (anchored against text);
 * this module is the bridge between that semantic state and the runtime
 * `EditorState`. It owns four operations:
 *
 *   - Capture: build a thread from an editor selection.
 *   - Projection: resolve every persisted thread against the current snapshot
 *     and emit runtime ranges plus repaired thread copies.
 *   - Viewport geometry: resolve a comment range to document-space bounds.
 *   - Edit-time repair: optimistically remap thread anchors during inline
 *     edits so threads stay sticky to their text without a full re-resolve.
 */

import {
  anchorKindForBlockType,
  createAnchorFromContainer,
  createCommentThread,
  extractQuoteFromContainer,
  resolveCommentThread,
  type AnchorContainer,
  type CommentResolution,
  type CommentThread,
} from "@/document";
import { resolveRegionByPath, type DocumentIndex, type EditorRegion } from "../../state";
import {
  findLineEntryForRegionOffset,
  findVisibleLineRange,
  resolvePositionInViewport,
  type EditorLayoutState,
} from "../../layout";
import type { EditorState } from "../../state/types";
import { projectAnchorContainersToEditor } from "../index";
import type { EditorPresence } from "../presence";
import { remapEditedRange } from "./remap";

// --- Types ---

export type EditorCommentRange = {
  endOffset: number;
  resolution: CommentResolution;
  regionId: string;
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
    regionId: string;
    startOffset: number;
  },
  body: string,
) {
  const normalizedBody = body.trim();

  if (normalizedBody.length === 0 || selection.startOffset === selection.endOffset) {
    return null;
  }

  const region = documentIndex.regionIndex.get(selection.regionId) ?? null;
  const container = region ? toAnchorContainer(documentIndex, region) : null;

  if (!container) {
    return null;
  }

  return createCommentThread({
    anchor: createAnchorFromContainer(container, selection.startOffset, selection.endOffset),
    body: normalizedBody,
    quote: extractQuoteFromContainer(container, selection.startOffset, selection.endOffset),
  });
}

// --- Projection ---

// Resolve every persisted thread against the current document snapshot and
// emit runtime ranges plus repaired thread copies. Threads whose anchors
// don't resolve are silently dropped from `ranges` while their persisted
// `threads` entry stays untouched, ready to repair when the document
// changes again.
export function getCommentState(state: EditorState): EditorCommentState;
export function getCommentState(documentIndex: DocumentIndex): EditorCommentState;
export function getCommentState(stateOrIndex: EditorState | DocumentIndex): EditorCommentState {
  const documentIndex = "documentIndex" in stateOrIndex ? stateOrIndex.documentIndex : stateOrIndex;
  const containerProjection = projectAnchorContainersToEditor(documentIndex);
  const threads = documentIndex.document.comments;
  const resolvedThreads = [...threads];
  const ranges: EditorCommentRange[] = [];

  for (const [threadIndex, thread] of threads.entries()) {
    const resolution = resolveCommentThread(thread, documentIndex.document);

    if (!resolution.match) {
      continue;
    }

    const projection = containerProjection.findBySemanticMatch(
      resolution.match.containerId,
      resolution.match.containerOrdinal,
    );
    const runtimeContainer = projection?.runtimeContainer ?? null;

    if (!runtimeContainer) {
      continue;
    }

    if (resolution.repair) {
      resolvedThreads[threadIndex] = {
        ...thread,
        anchor: resolution.repair.anchor,
        quote: resolution.repair.quote,
      };
    }

    ranges.push({
      endOffset: resolution.match.endOffset,
      resolution,
      regionId: runtimeContainer.id,
      resolved: thread.resolvedAt != null,
      startOffset: resolution.match.startOffset,
      threadIndex,
    });
  }

  return {
    ranges,
    threads: resolvedThreads,
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

  const { endIndex, startIndex } = findVisibleLineRange(
    viewport.layout,
    viewport.viewport.top,
    viewport.viewport.height,
  );

  for (let lineIndex = startIndex; lineIndex < endIndex; lineIndex += 1) {
    const line = viewport.layout.lines[lineIndex];
    if (!line) {
      continue;
    }

    if (
      resolvePositionInViewport(viewport, {
        bottom: line.top + line.height,
        top: line.top,
      }) !== "visible"
    ) {
      continue;
    }

    if (
      ranges.some(
        (range) =>
          !range.resolved &&
          commentPresence.has(range.threadIndex) &&
          range.regionId === line.regionId &&
          range.endOffset > line.start &&
          range.startOffset < line.end,
      )
    ) {
      return true;
    }
  }

  return false;
}

// Return the index (into `Document.comments`) of the comment whose range
// either contains the collapsed caret or overlaps the active (non-collapsed)
// selection. Selections can cross regions, so positions are compared in
// document order via the `regionOrderIndex` already maintained on
// `DocumentIndex`.
export function resolveActiveCommentIndex(
  state: EditorState,
  ranges: readonly EditorCommentRange[],
): number | null {
  if (ranges.length === 0) {
    return null;
  }

  const { regionOrderIndex } = state.documentIndex;
  const { anchor, focus } = state.selection;

  const orientation = compareDocumentPositions(regionOrderIndex, anchor, focus);
  const isCollapsed = orientation === 0;
  const [start, end] = orientation <= 0 ? [anchor, focus] : [focus, anchor];

  for (const range of ranges) {
    const rangeStart = { regionId: range.regionId, offset: range.startOffset };
    const rangeEnd = { regionId: range.regionId, offset: range.endOffset };

    if (isCollapsed) {
      // Caret-in-range: rangeStart ≤ caret ≤ rangeEnd in document order.
      if (
        compareDocumentPositions(regionOrderIndex, rangeStart, start) <= 0 &&
        compareDocumentPositions(regionOrderIndex, start, rangeEnd) <= 0
      ) {
        return range.threadIndex;
      }
      continue;
    }

    // Open-interval overlap: max(selStart, rangeStart) < min(selEnd, rangeEnd).
    const overlapStart =
      compareDocumentPositions(regionOrderIndex, start, rangeStart) >= 0 ? start : rangeStart;
    const overlapEnd =
      compareDocumentPositions(regionOrderIndex, end, rangeEnd) <= 0 ? end : rangeEnd;
    if (compareDocumentPositions(regionOrderIndex, overlapStart, overlapEnd) < 0) {
      return range.threadIndex;
    }
  }

  return null;
}

// Lexicographic comparator on `(regionOrder, offset)`. Used to interleave
// selection points with comment-range bounds when the selection spans
// regions. Unknown regions fall back to `-1` so they sort before any known
// region — that matches the behavior of the prior packed-number scheme.
function compareDocumentPositions(
  regionOrderIndex: ReadonlyMap<string, number>,
  a: { regionId: string; offset: number },
  b: { regionId: string; offset: number },
): number {
  const aRegion = regionOrderIndex.get(a.regionId) ?? -1;
  const bRegion = regionOrderIndex.get(b.regionId) ?? -1;
  return aRegion !== bRegion ? aRegion - bRegion : a.offset - b.offset;
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
    range.regionId,
    range.startOffset,
  )?.line;
  const endLine = findLineEntryForRegionOffset(
    viewport.layout,
    range.regionId,
    Math.max(range.startOffset, range.endOffset - 1),
  )?.line;

  if (startLine && endLine) {
    return {
      bottom: Math.max(startLine.top + startLine.height, endLine.top + endLine.height),
      top: Math.min(startLine.top, endLine.top),
    };
  }

  return viewport.estimateRegionBounds(range.regionId);
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
  region: EditorRegion,
  selectionStart: number,
  selectionEnd: number,
  insertedText: string,
) {
  if (documentIndex.document.comments.length === 0) {
    return nextDocumentIndex.document.comments;
  }

  const threadIndices = documentIndex.commentContainerIndex.get(region.semanticRegionId) ?? [];
  const threadIndexSet = new Set(threadIndices);

  if (threadIndices.length === 0) {
    return nextDocumentIndex.document.comments;
  }

  const currentCommentState = getCommentState(documentIndex);
  const rangesByThreadIndex = new Map(
    currentCommentState.ranges.map((range) => [range.threadIndex, range]),
  );
  const currentContainer = toAnchorContainer(documentIndex, region);
  const nextRegion = resolveRegionByPath(nextDocumentIndex, region.path);
  const nextContainer = nextRegion ? toAnchorContainer(nextDocumentIndex, nextRegion) : null;

  if (!currentContainer || !nextContainer) {
    return nextDocumentIndex.document.comments;
  }

  return nextDocumentIndex.document.comments.map((thread, threadIndex) => {
    if (!threadIndexSet.has(threadIndex)) {
      return thread;
    }

    const currentRange = rangesByThreadIndex.get(threadIndex);
    const repairedMatch = currentRange?.resolution.match ?? null;

    if (!currentRange || !repairedMatch || repairedMatch.containerId !== currentContainer.id) {
      return thread;
    }

    const nextRange = remapEditedRange(
      repairedMatch.startOffset,
      repairedMatch.endOffset,
      selectionStart,
      selectionEnd,
      insertedText.length,
    );

    return {
      ...thread,
      anchor: createAnchorFromContainer(nextContainer, nextRange.start, nextRange.end),
      quote: extractQuoteFromContainer(nextContainer, nextRange.start, nextRange.end),
    };
  });
}

// --- Internal helpers ---

// Adapt a runtime `EditorRegion` into the `AnchorContainer` shape used by the
// document-layer anchor primitives. The `containerOrdinal: -1` is a sentinel:
// edit-time use never disambiguates by ordinal (we already know exactly which
// region we're touching), so we skip the ordinal computation. Returns `null`
// when the region isn't an anchorable kind (list markers, etc.).
function toAnchorContainer(
  documentIndex: DocumentIndex,
  region: EditorRegion,
): AnchorContainer | null {
  const containerKind = resolveAnchorContainerKind(documentIndex, region);

  if (!containerKind) {
    return null;
  }

  return {
    containerKind,
    containerOrdinal: -1,
    id: region.semanticRegionId,
    text: region.text,
  };
}

function resolveAnchorContainerKind(
  documentIndex: DocumentIndex,
  region: EditorRegion,
): AnchorContainer["containerKind"] | null {
  if (documentIndex.tableCellIndex.has(region.id)) {
    return "tableCell";
  }

  return anchorKindForBlockType(region.blockType);
}

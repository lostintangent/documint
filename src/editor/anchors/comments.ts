/**
 * Editor-side projection of comment threads.
 *
 * Comments themselves live on the semantic `Document` (anchored against text);
 * this module is the bridge between that semantic state and the runtime
 * `EditorState`. It owns three operations:
 *
 *   - Capture: build a thread from a live editor selection.
 *   - Projection: resolve every persisted thread against the current snapshot
 *     and emit live runtime ranges plus repaired thread copies.
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
import { resolveRegionByPath, type DocumentIndex, type EditorRegion } from "../state";
import type { EditorState } from "../state/types";
import { projectAnchorContainersToEditor } from "./index";
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
  liveRanges: EditorCommentRange[];
  threads: CommentThread[];
};

// --- Capture ---

// Build a `CommentThread` from a live selection inside the editor. Returns
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
// emit live runtime ranges plus repaired thread copies. Threads whose anchors
// don't resolve are silently dropped from `liveRanges` while their persisted
// `threads` entry stays untouched, ready to repair when the document
// changes again.
export function getCommentState(state: EditorState): EditorCommentState;
export function getCommentState(documentIndex: DocumentIndex): EditorCommentState;
export function getCommentState(stateOrIndex: EditorState | DocumentIndex): EditorCommentState {
  const documentIndex = "documentIndex" in stateOrIndex ? stateOrIndex.documentIndex : stateOrIndex;
  const containerProjection = projectAnchorContainersToEditor(documentIndex);
  const threads = documentIndex.document.comments;
  const resolvedThreads = [...threads];
  const liveRanges: EditorCommentRange[] = [];

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

    liveRanges.push({
      endOffset: resolution.match.endOffset,
      resolution,
      regionId: runtimeContainer.id,
      resolved: thread.resolvedAt != null,
      startOffset: resolution.match.startOffset,
      threadIndex,
    });
  }

  return {
    liveRanges,
    threads: resolvedThreads,
  };
}

// --- Edit-time repair ---

// Optimistically keep comments sticky within an edited region by remapping
// each affected thread's live range through the splice math. General
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
  const liveRangesByThreadIndex = new Map(
    currentCommentState.liveRanges.map((range) => [range.threadIndex, range]),
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

    const liveRange = liveRangesByThreadIndex.get(threadIndex);
    const repairedMatch = liveRange?.resolution.match ?? null;

    if (!liveRange || !repairedMatch || repairedMatch.containerId !== currentContainer.id) {
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

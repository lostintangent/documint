import {
  createCommentThread,
  createCommentAnchorFromContainer,
  createCommentQuoteFromContainer,
  resolveCommentThread,
  type CommentResolution,
  type CommentThread,
} from "@/comments";
import type { AnchorContainer } from "@/document";
import { resolveRegionByPath, type DocumentIndex, type EditorRegion } from "../state";
import type { EditorState } from "../state/state";
import { projectAnchorContainersToEditor } from "./index";

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
  const container = region ? toCommentAnchorContainer(documentIndex, region) : null;

  if (!container) {
    return null;
  }

  return createCommentThread({
    anchor: createCommentAnchorFromContainer(container, selection.startOffset, selection.endOffset),
    body: normalizedBody,
    quote: createCommentQuoteFromContainer(container, selection.startOffset, selection.endOffset),
  });
}

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

export function updateCommentThreadsForRegionEdit(
  documentIndex: DocumentIndex,
  nextDocumentIndex: DocumentIndex,
  region: EditorRegion,
  selectionStart: number,
  selectionEnd: number,
  insertedText: string,
) {
  // Optimistically keep comments sticky within the edited region by remapping
  // the current live range through the text edit. General comment resolution
  // still lives in src/comments and runs against the next Document snapshot.
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
  const currentContainer = toCommentAnchorContainer(documentIndex, region);
  const nextRegion = resolveRegionByPath(nextDocumentIndex, region.path);
  const nextContainer = nextRegion ? toCommentAnchorContainer(nextDocumentIndex, nextRegion) : null;

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

    if (!nextRange) {
      return thread;
    }

    return {
      ...thread,
      anchor: createCommentAnchorFromContainer(nextContainer, nextRange.start, nextRange.end),
      quote: createCommentQuoteFromContainer(nextContainer, nextRange.start, nextRange.end),
    };
  });
}

function toCommentAnchorContainer(
  documentIndex: DocumentIndex,
  region: EditorRegion,
): AnchorContainer | null {
  const containerKind = resolveCommentAnchorContainerKind(documentIndex, region);

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

function resolveCommentAnchorContainerKind(
  documentIndex: DocumentIndex,
  region: EditorRegion,
): AnchorContainer["containerKind"] | null {
  if (documentIndex.tableCellIndex.has(region.id)) {
    return "tableCell";
  }

  switch (region.blockType) {
    case "code":
      return "code";
    case "heading":
    case "paragraph":
      return "text";
    default:
      return null;
  }
}

function remapEditedRange(
  start: number,
  end: number,
  editStart: number,
  editEnd: number,
  insertedLength: number,
) {
  const deletedLength = editEnd - editStart;
  const delta = insertedLength - deletedLength;

  if (editEnd <= start) {
    return {
      end: end + delta,
      start: start + delta,
    };
  }

  if (editStart >= end) {
    return {
      end,
      start,
    };
  }

  const preservedPrefixLength = Math.max(0, Math.min(editStart, end) - start);
  const preservedSuffixLength = Math.max(0, end - Math.max(editEnd, start));
  const nextStart = start < editStart ? start : editStart;
  const nextEnd = nextStart + preservedPrefixLength + insertedLength + preservedSuffixLength;

  return {
    end: nextEnd,
    start: nextStart,
  };
}

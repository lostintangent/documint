import {
  createCommentThread,
  createCommentAnchorFromContainer,
  createCommentQuoteFromContainer,
  listCommentTargetContainers,
  repairCommentThread,
  type CommentTargetContainer,
  type CommentRepairResult,
  type CommentThread,
} from "@/comments";
import type { DocumentEditor, DocumentEditorRegion } from "./model/document-editor";

export type CanvasLiveCommentRange = {
  diagnostics: string[];
  end: number;
  repair: CommentRepairResult;
  resolved: boolean;
  start: number;
  threadIndex: number;
};

export type CommentState = {
  liveRanges: CanvasLiveCommentRange[];
  threads: CommentThread[];
};

export function createCommentThreadForSelection(
  documentEditor: DocumentEditor,
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

  const region = documentEditor.regionIndex.get(selection.regionId) ?? null;
  const container = region ? toCommentTargetContainer(documentEditor, region) : null;

  if (!container) {
    return null;
  }

  return createCommentThread({
    anchor: createCommentAnchorFromContainer(
      container,
      selection.startOffset,
      selection.endOffset,
    ),
    body: normalizedBody,
    quote: createCommentQuoteFromContainer(
      container,
      selection.startOffset,
      selection.endOffset,
    ),
  });
}

export function getCommentState(documentEditor: DocumentEditor): CommentState {
  const semanticContainers = listCommentTargetContainers(documentEditor.document);
  const semanticContainersById = new Map(
    semanticContainers.map((container) => [container.id, container]),
  );
  const runtimeContainersBySemanticId = new Map(
    documentEditor.regions.map((region) => [region.semanticRegionId, region]),
  );
  const threads = documentEditor.document.comments;
  const repairedThreads = [...threads];
  const liveRanges: CanvasLiveCommentRange[] = [];

  for (const [threadIndex, thread] of threads.entries()) {
    const repair = repairCommentThread(thread, documentEditor.document);

    if (!repair.match) {
      continue;
    }

    const semanticContainer =
      semanticContainersById.get(repair.match.containerId) ??
      semanticContainers[repair.match.containerOrdinal] ??
      null;
    const runtimeContainer = semanticContainer
      ? runtimeContainersBySemanticId.get(semanticContainer.id) ?? null
      : null;

    if (!runtimeContainer) {
      continue;
    }

    if (repair.repairedThread) {
      repairedThreads[threadIndex] = repair.repairedThread;
    }

    liveRanges.push({
      diagnostics: repair.diagnostics,
      end: runtimeContainer.start + repair.match.endOffset,
      repair,
      resolved: thread.resolvedAt != null,
      start: runtimeContainer.start + repair.match.startOffset,
      threadIndex,
    });
  }

  return {
    liveRanges,
    threads: repairedThreads,
  };
}

export function updateCommentThreadsForRegionEdit(
  documentEditor: DocumentEditor,
  nextDocumentEditor: DocumentEditor,
  region: DocumentEditorRegion,
  selectionStart: number,
  selectionEnd: number,
  insertedText: string,
) {
  if (documentEditor.document.comments.length === 0) {
    return nextDocumentEditor.document.comments;
  }

  const threadIndices = documentEditor.commentContainerIndex.get(region.semanticRegionId) ?? [];
  const threadIndexSet = new Set(threadIndices);

  if (threadIndices.length === 0) {
    return nextDocumentEditor.document.comments;
  }

  const currentCommentState = getCommentState(documentEditor);
  const liveRangesByThreadIndex = new Map(
    currentCommentState.liveRanges.map((range) => [range.threadIndex, range]),
  );
  const currentContainer = toCommentTargetContainer(documentEditor, region);
  const nextRegion = nextDocumentEditor.regions.find((entry) => entry.path === region.path) ?? null;
  const nextContainer = nextRegion ? toCommentTargetContainer(nextDocumentEditor, nextRegion) : null;

  if (!currentContainer || !nextContainer) {
    return nextDocumentEditor.document.comments;
  }

  return nextDocumentEditor.document.comments.map((thread, threadIndex) => {
    if (!threadIndexSet.has(threadIndex)) {
      return thread;
    }

    const liveRange = liveRangesByThreadIndex.get(threadIndex);

    if (!liveRange || liveRange.repair.match?.containerId !== currentContainer.id) {
      return thread;
    }

    const nextRange = remapEditedRange(
      liveRange.repair.match.startOffset,
      liveRange.repair.match.endOffset,
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

function toCommentTargetContainer(
  documentEditor: DocumentEditor,
  region: DocumentEditorRegion,
): CommentTargetContainer | null {
  const containerKind = resolveCommentContainerKind(documentEditor, region);

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

function resolveCommentContainerKind(
  documentEditor: DocumentEditor,
  region: DocumentEditorRegion,
): CommentTargetContainer["containerKind"] | null {
  if (documentEditor.tableCellIndex.has(region.id)) {
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

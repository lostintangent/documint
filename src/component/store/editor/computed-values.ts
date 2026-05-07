import {
  getCommentState,
  getSelectionContext,
  getSelectionMarks,
  getSelectionRange,
  measureCaretTarget,
  measureInlineImageBounds,
  measureVisualCaretTarget,
  normalizeSelection,
  resolveCursorViewportStatus,
  resolveImageAtSelection,
  resolveTargetAtSelection,
  type EditorHoverTarget,
  type EditorLayoutState,
  type EditorInline,
  type EditorSelectionRange,
  type EditorState,
  type CaretTarget,
  type InlineBounds,
  type NormalizedEditorSelection,
} from "@/editor";
import { isResolvedCommentThread, type Mark } from "@/document";
import type { DocumentResources } from "@/types";
import {
  areLeafBasesEqual,
  type AnnotationLeaf,
  type InsertionLeaf,
  type LinkLeaf,
  resolveContextualLeaf,
  type TableLeaf,
  type ThreadLeaf,
} from "../../overlays/leaves/core/shared";
import {
  createParameterizedStoreComputedValue as parameterizedComputedValue,
  createStoreRecordValue as recordValue,
  createStoreComputedValue as computedValue,
} from "../core/computed";
import {
  equalArrayBy,
  equalCommentStates,
  equalNullableBy,
  equalMarks,
  equalNormalizedSelections,
  equalSelectionContexts,
} from "../core/equality";
import type { DocumintStoreValue } from "../core/values";
import { publishedViewportValue } from "../viewport/values";
import { editorStateValue } from "./values";

type SelectionRange = EditorSelectionRange | null;

type SelectionHandles = {
  end: { left: number; top: number };
  start: { left: number; top: number };
} | null;

type CommentLiveRanges = ReturnType<typeof getCommentState>["liveRanges"];
type ContextualLeaf = LinkLeaf | ThreadLeaf;

export type PromotedSelectionThread = {
  anchor: NormalizedEditorSelection["start"];
  animateInitialComment: boolean;
  leftOverride?: number;
  paddingY?: number;
  selection: NonNullable<SelectionRange>;
  threadIndex: number;
};

export type SelectionLeaf = AnnotationLeaf | ThreadLeaf;

export type CursorLeaf = InsertionLeaf | LinkLeaf | TableLeaf | ThreadLeaf;

export type PointerLeaf = ContextualLeaf;

export type PointerView = {
  cursor: "pointer" | "text";
  leaf: PointerLeaf | null;
};

export type SelectionView = {
  handles: SelectionHandles;
  marks: readonly Mark[];
  normalized: NormalizedEditorSelection;
  range: SelectionRange;
  viewport: EditorLayoutState | null;
};

export type ImageAtCursor = {
  bounds: InlineBounds;
  maxWidth: number | null;
  regionId: string;
  run: EditorInline;
};

const equalSelectionRanges = equalNullableBy<NonNullable<SelectionRange>>((range) => [
  range.regionId,
  range.startOffset,
  range.endOffset,
]);

const equalSelectionHandles = equalNullableBy<NonNullable<SelectionHandles>>((handles) => [
  handles.start.left,
  handles.start.top,
  handles.end.left,
  handles.end.top,
]);

export const commentStateValue = computedValue(
  [editorStateValue] as const,
  (_store, state) => getCommentState(state),
  equalCommentStates,
);

const commentThreadsValue = computedValue(
  [commentStateValue] as const,
  (_store, commentState) => commentState.threads,
  equalArrayBy(Object.is),
);

const commentLiveRangesValue = computedValue(
  [commentStateValue] as const,
  (_store, commentState) => commentState.liveRanges,
  equalCommentLiveRanges,
);

/* Selection */

export const normalizedSelectionValue = computedValue(
  [editorStateValue] as const,
  (_store, state) => normalizeSelection(state),
  equalNormalizedSelections,
);

const selectionRangeValue = computedValue(
  [editorStateValue] as const,
  (_store, state) => getSelectionRange(state),
  equalSelectionRanges,
);

const selectionMarksValue = computedValue(
  [editorStateValue] as const,
  (_store, state) => getSelectionMarks(state),
  equalMarks,
);

const selectionHandlesValue = computedValue(
  [editorStateValue, normalizedSelectionValue, publishedViewportValue] as const,
  (_store, state, normalizedSelection, viewport) => {
    if (!viewport) {
      return null;
    }

    return resolveSelectionHandles(state, viewport, normalizedSelection);
  },
  equalSelectionHandles,
);

export const selectionViewValue: DocumintStoreValue<SelectionView> = recordValue({
  handles: selectionHandlesValue,
  marks: selectionMarksValue,
  normalized: normalizedSelectionValue,
  range: selectionRangeValue,
  viewport: publishedViewportValue,
});

export const selectionLeafValue = parameterizedComputedValue(
  [selectionRangeValue, selectionMarksValue, selectionHandlesValue, commentThreadsValue] as const,
  (
    _store,
    [promotedThread]: readonly [PromotedSelectionThread | null],
    selectionRange,
    activeMarks,
    handles,
    threads,
  ): SelectionLeaf | null => {
    return resolveSelectionLeaf({
      activeMarks,
      handles,
      promotedThread,
      selectionRange,
      threads,
    });
  },
  equalSelectionLeaves,
);

/* Cursor */

export const cursorLeafValue = parameterizedComputedValue(
  [
    editorStateValue,
    normalizedSelectionValue,
    publishedViewportValue,
    commentThreadsValue,
    commentLiveRangesValue,
  ] as const,
  (
    _store,
    [isEditable]: readonly [boolean],
    state,
    normalizedSelection,
    viewport,
    threads,
    liveRanges,
  ): CursorLeaf | null => {
    if (!viewport) {
      return null;
    }

    return resolveCursorLeaf({
      isEditable,
      liveRanges,
      normalizedSelection,
      state,
      threads,
      viewport,
    });
  },
  equalCursorLeaves,
);

export const caretInViewportValue = computedValue(
  [editorStateValue, normalizedSelectionValue, publishedViewportValue] as const,
  (_store, state, normalizedSelection, viewport): boolean => {
    if (!viewport) {
      return true;
    }

    const status = resolveCursorViewportStatus(state, viewport, normalizedSelection.end);
    return status !== "above" && status !== "below";
  },
);

export const caretTargetValue = computedValue(
  [editorStateValue, normalizedSelectionValue, publishedViewportValue] as const,
  (_store, state, normalizedSelection, viewport): CaretTarget | null => {
    if (!viewport) {
      return null;
    }

    return measureCaretTarget(state, viewport, normalizedSelection.end);
  },
  equalCaretTargets,
);

/* Pointer */

export const pointerViewValue = parameterizedComputedValue(
  [editorStateValue, publishedViewportValue, commentThreadsValue, commentLiveRangesValue] as const,
  (
    _store,
    [hoverTarget]: readonly [EditorHoverTarget | null],
    state,
    viewport,
    threads,
    liveRanges,
  ): PointerView => {
    const target =
      hoverTarget?.kind === "link" && viewport
        ? resolveTargetAtSelection(state, viewport, {
            regionId: hoverTarget.regionId,
            offset: resolveLinkInteriorOffset(hoverTarget),
          })
        : hoverTarget;
    const leaf = resolveContextualLeaf(target, threads, liveRanges);
    const cursor =
      hoverTarget?.kind === "task-toggle" || leaf?.kind === "link" ? "pointer" : "text";

    return { cursor, leaf };
  },
  equalPointerViews,
);

/* Host */

export const selectionContextValue = computedValue(
  [editorStateValue] as const,
  (_store, state) => getSelectionContext(state),
  equalSelectionContexts,
);

/* Images */

export const imageAtCursorValue = parameterizedComputedValue(
  [editorStateValue, normalizedSelectionValue, publishedViewportValue] as const,
  (
    _store,
    [resources]: readonly [DocumentResources | null],
    state,
    normalizedSelection,
    viewport,
  ) => {
    if (!resources || !viewport) {
      return null;
    }

    return resolveImageAtCursor(state, viewport, normalizedSelection, resources);
  },
  equalImageAtCursors,
);

function resolveImageAtCursor(
  state: EditorState,
  viewport: EditorLayoutState,
  normalizedSelection: NormalizedEditorSelection,
  resources: DocumentResources,
): ImageAtCursor | null {
  if (!normalizedSelection.collapsed) {
    return null;
  }

  const imageRun = resolveImageAtSelection(state);

  if (!imageRun) {
    return null;
  }

  const bounds = measureInlineImageBounds(state, viewport, resources, imageRun);
  const maxWidth = imageRun.image
    ? (resources.images.get(imageRun.image.url)?.intrinsicWidth ?? null)
    : null;
  const regionId = state.selection.anchor.regionId;

  return bounds ? { bounds, maxWidth, regionId, run: imageRun } : null;
}

function equalImageAtCursors(previous: ImageAtCursor | null, next: ImageAtCursor | null) {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.regionId === next.regionId &&
    previous.maxWidth === next.maxWidth &&
    previous.bounds.left === next.bounds.left &&
    previous.bounds.top === next.bounds.top &&
    previous.bounds.width === next.bounds.width &&
    previous.bounds.height === next.bounds.height
  );
}

function resolveSelectionHandles(
  state: EditorState,
  viewport: EditorLayoutState,
  selection: NormalizedEditorSelection,
): SelectionHandles {
  if (selection.collapsed) {
    return null;
  }

  const startCaret = measureVisualCaretTarget(state, viewport, selection.start);
  const endCaret = measureVisualCaretTarget(state, viewport, selection.end);

  if (!startCaret || !endCaret) {
    return null;
  }

  return {
    end: {
      left: endCaret.left,
      top: endCaret.top + endCaret.height,
    },
    start: {
      left: startCaret.left,
      top: startCaret.top,
    },
  };
}

// Small vertical nudge below the selection-end's line bottom. Pairs with the
// 14px CSS margin-top on the selection-mode anchor wrapper to give the
// annotation toolbar a touch of breathing room from the selection highlight.
const selectionLeafVerticalNudge = 2;

function resolveAnnotationLeaf(
  selection: NonNullable<SelectionRange>,
  handles: NonNullable<SelectionHandles>,
  activeMarks: readonly Mark[],
): AnnotationLeaf {
  return {
    activeMarks,
    // Anchor row comes from selection-end (the leaf renders below the
    // entire selected range).
    anchor: { regionId: selection.regionId, offset: selection.endOffset },
    kind: "annotation",
    // Cross-corner: x from selection-start while top comes from
    // selection-end's row, so the leaf sits at the bottom-left of the
    // range's bounding box.
    leftOverride: handles.start.left,
    paddingY: selectionLeafVerticalNudge,
    selection,
  };
}

function resolveSelectionLeaf({
  activeMarks,
  handles,
  promotedThread,
  selectionRange,
  threads,
}: {
  activeMarks: readonly Mark[];
  handles: SelectionHandles;
  promotedThread: PromotedSelectionThread | null;
  selectionRange: SelectionRange;
  threads: ReturnType<typeof getCommentState>["threads"];
}): SelectionLeaf | null {
  if (!selectionRange || !handles) {
    return null;
  }

  if (promotedThread && areSelectionRangesEqual(promotedThread.selection, selectionRange)) {
    const thread = threads[promotedThread.threadIndex];
    if (!thread) return null;

    return {
      ...promotedThread,
      kind: "thread",
      link: null,
      resolved: isResolvedCommentThread(thread),
      thread,
    };
  }

  return resolveAnnotationLeaf(selectionRange, handles, activeMarks);
}

function areSelectionRangesEqual(
  previous: NonNullable<SelectionRange>,
  next: NonNullable<SelectionRange>,
) {
  return (
    previous.endOffset === next.endOffset &&
    previous.regionId === next.regionId &&
    previous.startOffset === next.startOffset
  );
}

function equalSelectionLeaves(previous: SelectionLeaf | null, next: SelectionLeaf | null) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  if (previous.kind !== next.kind) return false;

  switch (previous.kind) {
    case "annotation":
      return (
        next.kind === "annotation" &&
        areLeafBasesEqual(previous, next) &&
        equalMarks(previous.activeMarks, next.activeMarks) &&
        areSelectionRangesEqual(previous.selection, next.selection)
      );
    case "thread":
      return next.kind === "thread" && equalContextualLeaves(previous, next);
  }
}

function resolveCursorLeaf({
  isEditable,
  liveRanges,
  normalizedSelection,
  state,
  threads,
  viewport,
}: {
  isEditable: boolean;
  liveRanges: CommentLiveRanges;
  normalizedSelection: NormalizedEditorSelection;
  state: EditorState;
  threads: ReturnType<typeof getCommentState>["threads"];
  viewport: EditorLayoutState;
}): CursorLeaf | null {
  const focus = state.selection.focus;

  if (!normalizedSelection.collapsed) {
    return null;
  }

  const insertionLeaf = isEditable ? resolveInsertionLeaf(state) : null;

  if (insertionLeaf) {
    return insertionLeaf;
  }

  const tableLeaf = isEditable ? resolveTableLeaf(state, viewport) : null;

  if (tableLeaf) {
    return tableLeaf;
  }

  return resolveContextualLeaf(
    resolveTargetAtSelection(state, viewport, focus),
    threads,
    liveRanges,
  );
}

function resolveTableLeaf(state: EditorState, viewport: EditorLayoutState): TableLeaf | null {
  const focus = state.selection.focus;
  const focusedRegion = state.documentIndex.regionIndex.get(focus.regionId);
  const tableCellPosition = focusedRegion
    ? (state.documentIndex.tableCellIndex.get(focusedRegion.id) ?? null)
    : null;

  if (!focusedRegion || !tableCellPosition) {
    return null;
  }

  const blockEntry = state.documentIndex.blockIndex.get(focusedRegion.blockId);
  const table =
    blockEntry?.type === "table" ? state.documentIndex.document.blocks[blockEntry.rootIndex] : null;

  if (!blockEntry || !table || table.type !== "table") {
    return null;
  }

  const textLeft = resolveRegionTextLeft(viewport, focusedRegion.id);
  const columnCount = Math.max(1, ...table.rows.map((row) => row.cells.length));

  return textLeft !== null
    ? {
        anchor: focus,
        cellIndex: tableCellPosition.cellIndex,
        columnCount,
        kind: "table",
        // The cell's text-area edge isn't a caret position, so override the
        // host's default left (caret-x at the anchor).
        leftOverride: textLeft,
        rowCount: table.rows.length,
        rowIndex: tableCellPosition.rowIndex,
      }
    : null;
}

function resolveRegionTextLeft(viewport: EditorLayoutState, regionId: string) {
  const firstLine = viewport.layout.lines.find((line) => line.regionId === regionId);

  return firstLine ? firstLine.left : null;
}

function resolveInsertionLeaf(state: EditorState): InsertionLeaf | null {
  const focus = state.selection.focus;
  const focusedRegion = state.documentIndex.regionIndex.get(focus.regionId);

  if (!focusedRegion || focusedRegion.blockType !== "paragraph" || focusedRegion.text.length > 0) {
    return null;
  }

  if (focus.offset !== 0) {
    return null;
  }

  const blockEntry = state.documentIndex.blockIndex.get(focusedRegion.blockId);

  if (!blockEntry || blockEntry.parentBlockId !== null) {
    return null;
  }

  return { anchor: focus, kind: "insertion" };
}

function equalCursorLeaves(previous: CursorLeaf | null, next: CursorLeaf | null) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  if (previous.kind !== next.kind) return false;

  switch (previous.kind) {
    case "thread":
      return next.kind === "thread" && equalContextualLeaves(previous, next);
    case "insertion":
      return next.kind === "insertion" && areLeafBasesEqual(previous, next);
    case "link":
      return next.kind === "link" && equalContextualLeaves(previous, next);
    case "table":
      return (
        next.kind === "table" &&
        areLeafBasesEqual(previous, next) &&
        previous.cellIndex === next.cellIndex &&
        previous.columnCount === next.columnCount &&
        previous.rowCount === next.rowCount &&
        previous.rowIndex === next.rowIndex
      );
  }
}

function equalCommentLiveRanges(previous: CommentLiveRanges, next: CommentLiveRanges) {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;

  return previous.every((range, index) => {
    const nextRange = next[index]!;
    return (
      range.endOffset === nextRange.endOffset &&
      range.regionId === nextRange.regionId &&
      range.resolved === nextRange.resolved &&
      range.startOffset === nextRange.startOffset &&
      range.threadIndex === nextRange.threadIndex
    );
  });
}

function equalCaretTargets(previous: CaretTarget | null, next: CaretTarget | null) {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.blockId === next.blockId &&
    previous.regionId === next.regionId &&
    previous.height === next.height &&
    previous.left === next.left &&
    previous.offset === next.offset &&
    previous.top === next.top
  );
}

function resolveLinkInteriorOffset(target: Extract<EditorHoverTarget, { kind: "link" }>) {
  return target.startOffset < target.endOffset ? target.startOffset + 1 : target.startOffset;
}

function equalPointerViews(previous: PointerView, next: PointerView) {
  return previous.cursor === next.cursor && equalPointerLeaves(previous.leaf, next.leaf);
}

function equalPointerLeaves(previous: PointerLeaf | null, next: PointerLeaf | null) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return equalContextualLeaves(previous, next);
}

function equalContextualLeaves(previous: ContextualLeaf, next: ContextualLeaf) {
  if (previous.kind !== next.kind) return false;
  if (!areLeafBasesEqual(previous, next)) return false;

  switch (previous.kind) {
    case "thread":
      return (
        next.kind === "thread" &&
        previous.animateInitialComment === next.animateInitialComment &&
        previous.link?.title === next.link?.title &&
        previous.link?.url === next.link?.url &&
        previous.resolved === next.resolved &&
        previous.thread === next.thread &&
        previous.threadIndex === next.threadIndex
      );
    case "link":
      return (
        next.kind === "link" &&
        previous.endOffset === next.endOffset &&
        previous.regionId === next.regionId &&
        previous.startOffset === next.startOffset &&
        previous.title === next.title &&
        previous.url === next.url
      );
  }
}

export const activeCommentThreadIndexValue = computedValue(
  [editorStateValue, commentStateValue] as const,
  (_store, state, commentState) => resolveActiveCommentThreadIndex(state, commentState.liveRanges),
);

function resolveActiveCommentThreadIndex(
  state: {
    documentIndex: {
      regions: Array<{
        id: string;
      }>;
    };
    selection: {
      anchor: {
        offset: number;
        regionId: string;
      };
      focus: {
        offset: number;
        regionId: string;
      };
    };
  },
  liveRanges: Array<{
    endOffset: number;
    regionId: string;
    startOffset: number;
    threadIndex: number;
  }>,
) {
  const regionOrderIndex = new Map(
    state.documentIndex.regions.map((region, index) => [region.id, index]),
  );
  const anchorOrder = resolveSelectionPointOrder(
    regionOrderIndex,
    state.selection.anchor.regionId,
    state.selection.anchor.offset,
  );
  const focusOrder = resolveSelectionPointOrder(
    regionOrderIndex,
    state.selection.focus.regionId,
    state.selection.focus.offset,
  );
  const [selectionStart, selectionEnd] =
    anchorOrder <= focusOrder ? [anchorOrder, focusOrder] : [focusOrder, anchorOrder];
  const isCollapsed = anchorOrder === focusOrder;

  for (const range of liveRanges) {
    const rangeStart = resolveSelectionPointOrder(
      regionOrderIndex,
      range.regionId,
      range.startOffset,
    );
    const rangeEnd = resolveSelectionPointOrder(regionOrderIndex, range.regionId, range.endOffset);

    if (isCollapsed) {
      if (selectionStart >= rangeStart && selectionStart <= rangeEnd) {
        return range.threadIndex;
      }

      continue;
    }

    if (Math.max(selectionStart, rangeStart) < Math.min(selectionEnd, rangeEnd)) {
      return range.threadIndex;
    }
  }

  return null;
}

function resolveSelectionPointOrder(
  regionOrderIndex: Map<string, number>,
  regionId: string,
  offset: number,
) {
  return (regionOrderIndex.get(regionId) ?? -1) * 1_000_000 + offset;
}

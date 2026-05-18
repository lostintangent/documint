import {
  getCommentState,
  getSelectionContext,
  getSelectionFormatting,
  getSelectionRange,
  measureCaretTarget,
  measureInlineImageBounds,
  measureVisualCaretTarget,
  normalizeSelection,
  resolveActiveCommentIndex,
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
  type SelectionFormatting,
} from "@/editor";
import { isResolvedCommentThread } from "@/document";
import type { DocumentResources, DocumentUser } from "@/types";
import {
  equalDocumentCompletions,
  resolveDocumentCompletionContext,
  type DocumentCompletion,
} from "../../completions/document-completions";
import { equalCompletionSources, type CompletionSource } from "../../completions/completions";
import { createMentionCompletionSource, emojiCompletionSource } from "../../completions/sources";
import {
  areLeafBasesEqual,
  type AnnotationLeaf,
  type InsertionLeaf,
  type LinkLeaf,
  resolveContextualLeaf,
  type TableLeaf,
  type ThreadLeaf,
} from "../../overlays/leaves/core/shared";
import { createComputedSprig, createParameterizedSprig, createRecordSprig } from "../core/computed";
import {
  equalArrayBy,
  equalArraysByIdentity,
  equalByKind,
  equalCommentRanges,
  equalCommentStates,
  equalNullable,
  equalNullableBy,
  equalNormalizedSelections,
  equalSelectionContexts,
} from "../core/equality";
import type { DocumintSprig } from "../core/sprigs";
import { publishedViewportSprig } from "../viewport/sprigs";
import { documentIndexSprig, editorStateSprig, selectionSprig } from "./sprigs";

export type { DocumentCompletion } from "../../completions/document-completions";

type SelectionRange = EditorSelectionRange | null;

type SelectionHandles = {
  end: { left: number; top: number };
  start: { left: number; top: number };
} | null;

type CommentRanges = ReturnType<typeof getCommentState>["ranges"];
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
  formatting: SelectionFormatting;
  handles: SelectionHandles;
  normalized: NormalizedEditorSelection;
  range: SelectionRange;
  viewport: EditorLayoutState | null;
};

export type ImageAtCursor = {
  bounds: InlineBounds;
  inline: EditorInline;
  maxWidth: number | null;
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

const equalCaretTargets = equalNullableBy<CaretTarget>((target) => [
  target.blockId,
  target.regionId,
  target.height,
  target.left,
  target.offset,
  target.top,
]);

const equalImageAtCursors = equalNullableBy<ImageAtCursor>((target) => [
  target.maxWidth,
  target.bounds.left,
  target.bounds.top,
  target.bounds.width,
  target.bounds.height,
]);

function equalSelectionFormatting(a: SelectionFormatting, b: SelectionFormatting) {
  return a.code === b.code && equalArraysByIdentity(a.marks, b.marks);
}

/* Leaf equality */

// Per-kind leaf equality. Each function compares only its own variant; the
// `equalByKind` dispatcher handles the identity short-circuit and kind
// discrimination once. Each leaf kind appears in exactly one function here,
// so the higher-level equalities (selection / cursor / contextual / pointer)
// are just different subsets of the same per-kind functions.

const equalAnnotationLeaf = (a: AnnotationLeaf, b: AnnotationLeaf): boolean =>
  areLeafBasesEqual(a, b) &&
  equalSelectionFormatting(a.formatting, b.formatting) &&
  areSelectionRangesEqual(a.selection, b.selection);

const equalInsertionLeaf = (a: InsertionLeaf, b: InsertionLeaf): boolean =>
  areLeafBasesEqual(a, b);

const equalLinkLeaf = (a: LinkLeaf, b: LinkLeaf): boolean =>
  areLeafBasesEqual(a, b) &&
  a.endOffset === b.endOffset &&
  a.regionId === b.regionId &&
  a.startOffset === b.startOffset &&
  a.title === b.title &&
  a.url === b.url;

const equalTableLeaf = (a: TableLeaf, b: TableLeaf): boolean =>
  areLeafBasesEqual(a, b) &&
  a.cellIndex === b.cellIndex &&
  a.columnCount === b.columnCount &&
  a.rowCount === b.rowCount &&
  a.rowIndex === b.rowIndex;

const equalThreadLeaf = (a: ThreadLeaf, b: ThreadLeaf): boolean =>
  areLeafBasesEqual(a, b) &&
  a.animateInitialComment === b.animateInitialComment &&
  a.link?.title === b.link?.title &&
  a.link?.url === b.link?.url &&
  a.resolved === b.resolved &&
  a.thread === b.thread &&
  a.threadIndex === b.threadIndex;

const equalContextualLeaves = equalByKind<ContextualLeaf>({
  link: equalLinkLeaf,
  thread: equalThreadLeaf,
});

const equalSelectionLeaves = equalNullable(
  equalByKind<SelectionLeaf>({
    annotation: equalAnnotationLeaf,
    thread: equalThreadLeaf,
  }),
);

const equalCursorLeaves = equalNullable(
  equalByKind<CursorLeaf>({
    insertion: equalInsertionLeaf,
    link: equalLinkLeaf,
    table: equalTableLeaf,
    thread: equalThreadLeaf,
  }),
);

const equalPointerLeaves = equalNullable<PointerLeaf>(equalContextualLeaves);

function equalPointerViews(previous: PointerView, next: PointerView) {
  return previous.cursor === next.cursor && equalPointerLeaves(previous.leaf, next.leaf);
}

// Depends on `documentIndexSprig` rather than `editorStateSprig` so selection-
// only transitions don't trigger a `getCommentState` walk. Comment state is
// purely a function of the document; the selection-side change has no effect.
export const commentStateSprig = createComputedSprig(
  [documentIndexSprig],
  (_store, documentIndex) => getCommentState(documentIndex),
  equalCommentStates,
);

const commentThreadsSprig = createComputedSprig(
  [commentStateSprig],
  (_store, commentState) => commentState.threads,
  equalArrayBy(Object.is),
);

const commentRangesSprig = createComputedSprig(
  [commentStateSprig],
  (_store, commentState) => commentState.ranges,
  equalCommentRanges,
);

/* Selection */

export const normalizedSelectionSprig = createComputedSprig(
  [documentIndexSprig, selectionSprig],
  (_store, documentIndex, selection) => normalizeSelection(documentIndex, selection),
  equalNormalizedSelections,
);

const selectionRangeSprig = createComputedSprig(
  [editorStateSprig],
  (_store, state) => getSelectionRange(state),
  equalSelectionRanges,
);

const selectionFormattingSprig = createComputedSprig(
  [editorStateSprig],
  (_store, state) => getSelectionFormatting(state),
  equalSelectionFormatting,
);

const selectionHandlesSprig = createComputedSprig(
  [editorStateSprig, normalizedSelectionSprig, publishedViewportSprig],
  (_store, state, normalizedSelection, viewport) => {
    if (!viewport) {
      return null;
    }

    return resolveSelectionHandles(state, viewport, normalizedSelection);
  },
  equalSelectionHandles,
);

export const selectionViewSprig: DocumintSprig<SelectionView> = createRecordSprig({
  formatting: selectionFormattingSprig,
  handles: selectionHandlesSprig,
  normalized: normalizedSelectionSprig,
  range: selectionRangeSprig,
  viewport: publishedViewportSprig,
});

export const selectionLeafSprig = createParameterizedSprig(
  [selectionRangeSprig, selectionFormattingSprig, selectionHandlesSprig, commentThreadsSprig],
  (
    _store,
    [promotedThread]: readonly [PromotedSelectionThread | null],
    selectionRange,
    formatting,
    handles,
    threads,
  ): SelectionLeaf | null => {
    return resolveSelectionLeaf({
      formatting,
      handles,
      promotedThread,
      selectionRange,
      threads,
    });
  },
  equalSelectionLeaves,
);

/* Cursor */

export const cursorLeafSprig = createParameterizedSprig(
  [
    editorStateSprig,
    normalizedSelectionSprig,
    publishedViewportSprig,
    commentThreadsSprig,
    commentRangesSprig,
  ],
  (
    _store,
    [isEditable]: readonly [boolean],
    state,
    normalizedSelection,
    viewport,
    threads,
    ranges,
  ): CursorLeaf | null => {
    if (!viewport) {
      return null;
    }

    return resolveCursorLeaf({
      isEditable,
      ranges,
      normalizedSelection,
      state,
      threads,
      viewport,
    });
  },
  equalCursorLeaves,
);

export const caretInViewportSprig = createComputedSprig(
  [editorStateSprig, normalizedSelectionSprig, publishedViewportSprig],
  (_store, state, normalizedSelection, viewport): boolean => {
    if (!viewport) {
      return true;
    }

    const status = resolveCursorViewportStatus(state, viewport, normalizedSelection.end);
    return status !== "above" && status !== "below";
  },
);

export const caretTargetSprig = createComputedSprig(
  [editorStateSprig, normalizedSelectionSprig, publishedViewportSprig],
  (_store, state, normalizedSelection, viewport): CaretTarget | null => {
    if (!viewport) {
      return null;
    }

    return measureCaretTarget(state, viewport, normalizedSelection.end);
  },
  equalCaretTargets,
);

export const documentCompletionSprig = createParameterizedSprig(
  [editorStateSprig],
  (
    _store,
    [completionSources]: readonly [CompletionSource[] | undefined],
    state,
  ): DocumentCompletion | null => {
    return resolveDocumentCompletionContext(state, completionSources);
  },
  equalDocumentCompletions,
);

export const completionSourcesSprig = createParameterizedSprig(
  [],
  (_store, [users]: readonly [readonly DocumentUser[] | undefined]): CompletionSource[] => {
    const mentionSource = createMentionCompletionSource(users);
    return mentionSource ? [mentionSource, emojiCompletionSource] : [emojiCompletionSource];
  },
  equalArrayBy(equalCompletionSources),
);

/* Pointer */

export const pointerViewSprig = createParameterizedSprig(
  [editorStateSprig, commentThreadsSprig, commentRangesSprig],
  (
    _store,
    [hoverTarget]: readonly [EditorHoverTarget | null],
    state,
    threads,
    ranges,
  ): PointerView => {
    const target =
      hoverTarget?.kind === "link"
        ? resolveTargetAtSelection(state, {
            regionId: hoverTarget.regionId,
            offset: resolveLinkInteriorOffset(hoverTarget),
          })
        : hoverTarget;
    const leaf = resolveContextualLeaf(target, threads, ranges);
    const cursor =
      hoverTarget?.kind === "task-toggle" || leaf?.kind === "link" ? "pointer" : "text";

    return { cursor, leaf };
  },
  equalPointerViews,
);

/* Host */

export const selectionContextSprig = createComputedSprig(
  [editorStateSprig],
  (_store, state) => getSelectionContext(state),
  equalSelectionContexts,
);

/* Images */

export const imageAtCursorSprig = createParameterizedSprig(
  [editorStateSprig, normalizedSelectionSprig, publishedViewportSprig],
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

  const imageInline = resolveImageAtSelection(state);

  if (!imageInline) {
    return null;
  }

  const bounds = measureInlineImageBounds(state, viewport, resources, imageInline);
  const maxWidth = imageInline.image
    ? (resources.images.get(imageInline.image.url)?.intrinsicWidth ?? null)
    : null;

  return bounds ? { bounds, inline: imageInline, maxWidth } : null;
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
  formatting: SelectionFormatting,
): AnnotationLeaf {
  return {
    formatting,
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
  formatting,
  handles,
  promotedThread,
  selectionRange,
  threads,
}: {
  formatting: SelectionFormatting;
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

  return resolveAnnotationLeaf(selectionRange, handles, formatting);
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

function resolveCursorLeaf({
  isEditable,
  ranges,
  normalizedSelection,
  state,
  threads,
  viewport,
}: {
  isEditable: boolean;
  ranges: CommentRanges;
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

  const contextualLeaf = resolveContextualLeaf(
    resolveTargetAtSelection(state, focus),
    threads,
    ranges,
  );

  if (contextualLeaf) {
    return contextualLeaf;
  }

  const tableLeaf = isEditable ? resolveTableLeaf(state, viewport) : null;

  if (tableLeaf) {
    return tableLeaf;
  }

  return null;
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

function resolveLinkInteriorOffset(target: Extract<EditorHoverTarget, { kind: "link" }>) {
  return target.startOffset < target.endOffset ? target.startOffset + 1 : target.startOffset;
}

export const activeCommentIndexSprig = createComputedSprig(
  [editorStateSprig, commentStateSprig],
  (_store, state, commentState) => resolveActiveCommentIndex(state, commentState.ranges),
);

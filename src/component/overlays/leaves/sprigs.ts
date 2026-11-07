// Overlay leaf view-model sprigs.
//
// These sprigs decide *which* leaf overlay should appear given selection,
// cursor, hover, and viewport state. They live next to the leaf components
// they drive — the store provides reactive primitives (selection geometry,
// comment state, viewport publication, etc.); overlays compose them into
// view models. This keeps the store from depending on overlay-owned leaf
// types.

import { getTableColumnCount } from "@/document";
import {
  isCanvasDirectActivationTarget,
  isMetadataPath,
  isRootIndexedBlock,
  resolveEditorTextAtPath,
  resolveIndexedBlock,
  resolveIndexedBlockContainingPath,
  resolveIndexedTableCell,
  resolveTargetAtOffset,
  type EditorHoverTarget,
  type EditorLayoutState,
  type EditorSelectionRange,
  type EditorState,
  type NormalizedEditorSelection,
  type SelectionFormatting,
} from "@/editor";
import { createParameterizedSprig } from "../../store/core/computed";
import { equalByKind, equalNullable, equalShallowObject } from "../../store/core/equality";
import {
  commentRangesSprig,
  commentThreadsSprig,
  equalSelectionFormatting,
  normalizedSelectionSprig,
  selectionFormattingSprig,
  selectionHandlesSprig,
  selectionRangeSprig,
  type SelectionHandles,
} from "../../store/editor/computed-sprigs";
import { editorStateSprig } from "../../store/editor/sprigs";
import { renderedLayoutSprig } from "../../store/layout/sprigs";
import {
  areDocumentAnchorTargetsEqual,
  resolveContextualLeaf,
  type AnnotationLeaf,
  type InsertionLeaf,
  type LinkLeaf,
  type TableLeaf,
  type ThreadLeaf,
} from "./core/shared";

type CommentRanges = ReturnType<typeof commentRangesSprig.read>;
type CommentThreads = ReturnType<typeof commentThreadsSprig.read>;
type ContextualLeaf = LinkLeaf | ThreadLeaf;

// The thread just created from `selection`. It is looked up by id, so it
// survives other threads being deleted, and takes its geometry from the
// selection toolbar it replaces. Once it is deleted, the toolbar returns.
export type PromotedSelectionThread = {
  selection: EditorSelectionRange;
  threadId: string;
};

export type SelectionLeaf = AnnotationLeaf | ThreadLeaf;
export type CursorLeaf = InsertionLeaf | LinkLeaf | TableLeaf | ThreadLeaf;
export type PointerLeaf = ContextualLeaf;

export type PointerView = {
  cursor: "pointer" | "text";
  leaf: PointerLeaf | null;
};

/* Leaf equality */

// Per-kind leaf equality. Each function compares only its own variant; the
// `equalByKind` dispatcher handles the identity short-circuit and kind
// discrimination once. Each leaf kind appears in exactly one function here,
// so the higher-level equalities (selection / cursor / contextual / pointer)
// are just different subsets of the same per-kind functions.

const equalAnnotationLeaf = (a: AnnotationLeaf, b: AnnotationLeaf): boolean =>
  areDocumentAnchorTargetsEqual(a, b) &&
  equalSelectionFormatting(a.formatting, b.formatting) &&
  equalShallowObject(a.selection, b.selection);

const equalInsertionLeaf = (a: InsertionLeaf, b: InsertionLeaf): boolean =>
  areDocumentAnchorTargetsEqual(a, b);

const equalLinkLeaf = (a: LinkLeaf, b: LinkLeaf): boolean =>
  areDocumentAnchorTargetsEqual(a, b) &&
  a.endOffset === b.endOffset &&
  a.path === b.path &&
  a.startOffset === b.startOffset &&
  a.title === b.title &&
  a.url === b.url;

const equalTableLeaf = (a: TableLeaf, b: TableLeaf): boolean =>
  areDocumentAnchorTargetsEqual(a, b) &&
  a.columnCount === b.columnCount &&
  a.rowCount === b.rowCount;

// Thread identity equality is load-bearing: threads in this codebase are
// immutable, so reference identity captures any meaningful change. If
// threads ever gain in-place mutability, this needs to compare structurally.
const equalThreadLeaf = (a: ThreadLeaf, b: ThreadLeaf): boolean =>
  areDocumentAnchorTargetsEqual(a, b) &&
  a.animateInitialComment === b.animateInitialComment &&
  a.link?.title === b.link?.title &&
  a.link?.url === b.link?.url &&
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

/* Sprigs */

export const selectionLeafSprig = createParameterizedSprig(
  [
    editorStateSprig,
    selectionRangeSprig,
    selectionFormattingSprig,
    selectionHandlesSprig,
    commentThreadsSprig,
  ],
  (
    _store,
    [promotedThread]: readonly [PromotedSelectionThread | null],
    state,
    selectionRange,
    formatting,
    handles,
    threads,
  ): SelectionLeaf | null => {
    if (isMetadataPath(state.selection.anchor.path) || isMetadataPath(state.selection.focus.path)) {
      return null;
    }

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

export const cursorLeafSprig = createParameterizedSprig(
  [
    editorStateSprig,
    normalizedSelectionSprig,
    renderedLayoutSprig,
    commentThreadsSprig,
    commentRangesSprig,
  ],
  (
    _store,
    [readOnly]: readonly [boolean],
    state,
    normalizedSelection,
    layout,
    threads,
    ranges,
  ): CursorLeaf | null => {
    if (readOnly || !layout) {
      return null;
    }

    return resolveCursorLeaf({
      ranges,
      normalizedSelection,
      state,
      threads,
      layout,
    });
  },
  equalCursorLeaves,
);

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
        ? resolveTargetAtOffset(
            state,
            hoverTarget.path,
            resolveLinkInteriorOffset(hoverTarget),
            ranges,
          )
        : hoverTarget;
    const leaf = resolveContextualLeaf(target, threads, ranges);
    const cursor =
      isCanvasDirectActivationTarget(hoverTarget) ||
      hoverTarget?.kind === "resource" ||
      leaf?.kind === "link"
        ? "pointer"
        : "text";

    return { cursor, leaf };
  },
  equalPointerViews,
);

/* Leaf resolution (pure helpers) */

// Small vertical nudge below the selection-end's line bottom. Pairs with the
// 14px CSS margin-top on the selection-mode anchor wrapper to give the
// annotation toolbar a touch of breathing room from the selection highlight.
const selectionLeafVerticalNudge = 2;

function resolveAnnotationLeaf(
  selection: EditorSelectionRange,
  handles: SelectionHandles,
  formatting: SelectionFormatting,
): AnnotationLeaf {
  return {
    formatting,
    // Anchor row comes from selection-end (the leaf renders below the
    // entire selected range).
    anchor: { path: selection.path, offset: selection.endOffset },
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
  handles: SelectionHandles | null;
  promotedThread: PromotedSelectionThread | null;
  selectionRange: EditorSelectionRange | null;
  threads: CommentThreads;
}): SelectionLeaf | null {
  if (!selectionRange || !handles) {
    return null;
  }

  const annotationLeaf = resolveAnnotationLeaf(selectionRange, handles, formatting);

  if (!promotedThread || !equalShallowObject(promotedThread.selection, selectionRange)) {
    return annotationLeaf;
  }

  const threadIndex = threads.findIndex(({ id }) => id === promotedThread.threadId);
  if (threadIndex === -1) return annotationLeaf;

  return {
    anchor: annotationLeaf.anchor,
    animateInitialComment: true,
    kind: "thread",
    leftOverride: annotationLeaf.leftOverride,
    link: null,
    paddingY: annotationLeaf.paddingY,
    thread: threads[threadIndex],
    threadIndex,
  };
}

function resolveCursorLeaf({
  ranges,
  normalizedSelection,
  state,
  threads,
  layout,
}: {
  ranges: CommentRanges;
  normalizedSelection: NormalizedEditorSelection;
  state: EditorState;
  threads: CommentThreads;
  layout: EditorLayoutState;
}): CursorLeaf | null {
  if (!normalizedSelection.collapsed) {
    return null;
  }

  const { focus } = state.selection;

  return (
    resolveInsertionLeaf(state) ??
    resolveContextualLeaf(
      resolveTargetAtOffset(state, focus.path, focus.offset, ranges),
      threads,
      ranges,
    ) ??
    resolveTableLeaf(state, layout)
  );
}

function resolveTableLeaf(state: EditorState, layout: EditorLayoutState): TableLeaf | null {
  const focus = state.selection.focus;
  const tableCell = resolveIndexedTableCell(state.documentIndex, focus.path);

  if (!tableCell) {
    return null;
  }

  const blockEntry = resolveIndexedBlock(state.documentIndex, tableCell.tablePath);

  if (!blockEntry || blockEntry.block.type !== "table") {
    return null;
  }

  const firstLine = layout.layout.lines.find((line) => line.path === focus.path);
  // Cell path bounds span the row band, the box the renderer paints as the
  // cell's border, so the toolbar clears every line of the cell's text.
  const cell = layout.layout.pathBounds.get(focus.path);

  return firstLine && cell
    ? {
        anchor: focus,
        columnCount: getTableColumnCount(blockEntry.block),
        extentOverride: cell,
        kind: "table",
        // The cell's text-area edge isn't a caret position, so override the
        // host's default left (caret-x at the anchor).
        leftOverride: firstLine.left,
        rowCount: blockEntry.block.rows.length,
      }
    : null;
}

function resolveInsertionLeaf(state: EditorState): InsertionLeaf | null {
  const focus = state.selection.focus;
  const text = resolveEditorTextAtPath(state.documentIndex, focus.path);
  const blockEntry = resolveIndexedBlockContainingPath(state.documentIndex, focus.path);

  return blockEntry?.block.type === "paragraph" &&
    text === "" &&
    focus.offset === 0 &&
    isRootIndexedBlock(blockEntry)
    ? { anchor: focus, kind: "insertion" }
    : null;
}

function resolveLinkInteriorOffset(target: Extract<EditorHoverTarget, { kind: "link" }>) {
  return target.startOffset < target.endOffset ? target.startOffset + 1 : target.startOffset;
}

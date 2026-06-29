// Overlay leaf view-model sprigs.
//
// These sprigs decide *which* leaf overlay should appear given selection,
// cursor, hover, and viewport state. They live next to the leaf components
// they drive — the store provides reactive primitives (selection geometry,
// comment state, viewport publication, etc.); overlays compose them into
// view models. This keeps the store from depending on overlay-owned leaf
// types.

import { isResolvedCommentThread } from "@/document";
import {
  isRootIndexedBlock,
  resolveIndexedBlock,
  resolveRegion,
  resolveTargetAtSelection,
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

export type PromotedSelectionThread = {
  anchor: NormalizedEditorSelection["start"];
  animateInitialComment: boolean;
  leftOverride?: number;
  paddingY?: number;
  selection: EditorSelectionRange;
  threadIndex: number;
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
  a.regionPath === b.regionPath &&
  a.startOffset === b.startOffset &&
  a.title === b.title &&
  a.url === b.url;

const equalTableLeaf = (a: TableLeaf, b: TableLeaf): boolean =>
  areDocumentAnchorTargetsEqual(a, b) &&
  a.cellIndex === b.cellIndex &&
  a.columnCount === b.columnCount &&
  a.rowCount === b.rowCount &&
  a.rowIndex === b.rowIndex;

// Thread identity equality is load-bearing: threads in this codebase are
// immutable, so reference identity captures any meaningful change. If
// threads ever gain in-place mutability, this needs to compare structurally.
const equalThreadLeaf = (a: ThreadLeaf, b: ThreadLeaf): boolean =>
  areDocumentAnchorTargetsEqual(a, b) &&
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

/* Sprigs */

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
    if (!layout) {
      return null;
    }

    return resolveCursorLeaf({
      ranges,
      normalizedSelection,
      readOnly,
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
        ? resolveTargetAtSelection(state, {
            regionPath: hoverTarget.regionPath,
            offset: resolveLinkInteriorOffset(hoverTarget),
          })
        : hoverTarget;
    const leaf = resolveContextualLeaf(target, threads, ranges);
    const cursor =
      hoverTarget?.kind === "task-toggle" ||
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
    anchor: { regionPath: selection.regionPath, offset: selection.endOffset },
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

  if (promotedThread && equalShallowObject(promotedThread.selection, selectionRange)) {
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

function resolveCursorLeaf({
  ranges,
  normalizedSelection,
  readOnly,
  state,
  threads,
  layout,
}: {
  ranges: CommentRanges;
  normalizedSelection: NormalizedEditorSelection;
  readOnly: boolean;
  state: EditorState;
  threads: CommentThreads;
  layout: EditorLayoutState;
}): CursorLeaf | null {
  const focus = state.selection.focus;

  if (!normalizedSelection.collapsed) {
    return null;
  }

  const insertionLeaf = readOnly ? null : resolveInsertionLeaf(state);

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

  const tableLeaf = readOnly ? null : resolveTableLeaf(state, layout);

  if (tableLeaf) {
    return tableLeaf;
  }

  return null;
}

function resolveTableLeaf(state: EditorState, layout: EditorLayoutState): TableLeaf | null {
  const focus = state.selection.focus;
  const focusedRegion = resolveRegion(state.documentIndex, focus.regionPath);
  const tableCellPosition = focusedRegion?.tableCellPosition ?? null;

  if (!focusedRegion || !tableCellPosition) {
    return null;
  }

  const blockEntry = resolveIndexedBlock(state.documentIndex, focusedRegion.blockPath);

  if (!blockEntry || blockEntry.block.type !== "table") {
    return null;
  }

  const textLeft = resolveRegionTextLeft(layout, focusedRegion.path);
  const columnCount = Math.max(1, ...blockEntry.block.rows.map((row) => row.cells.length));

  return textLeft !== null
    ? {
        anchor: focus,
        cellIndex: tableCellPosition.cellIndex,
        columnCount,
        kind: "table",
        // The cell's text-area edge isn't a caret position, so override the
        // host's default left (caret-x at the anchor).
        leftOverride: textLeft,
        rowCount: blockEntry.block.rows.length,
        rowIndex: tableCellPosition.rowIndex,
      }
    : null;
}

function resolveRegionTextLeft(layout: EditorLayoutState, regionPath: string) {
  const firstLine = layout.layout.lines.find((line) => line.regionPath === regionPath);

  return firstLine ? firstLine.left : null;
}

function resolveInsertionLeaf(state: EditorState): InsertionLeaf | null {
  const focus = state.selection.focus;
  const focusedRegion = resolveRegion(state.documentIndex, focus.regionPath);

  if (!focusedRegion || focusedRegion.block.type !== "paragraph" || focusedRegion.text.length > 0) {
    return null;
  }

  if (focus.offset !== 0) {
    return null;
  }

  const blockEntry = resolveIndexedBlock(state.documentIndex, focusedRegion.blockPath);

  if (!blockEntry || !isRootIndexedBlock(blockEntry)) {
    return null;
  }

  return { anchor: focus, kind: "insertion" };
}

function resolveLinkInteriorOffset(target: Extract<EditorHoverTarget, { kind: "link" }>) {
  return target.startOffset < target.endOffset ? target.startOffset + 1 : target.startOffset;
}

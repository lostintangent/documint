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
  type EditorLayoutState,
  type IndexedInline,
  type EditorSelectionRange,
  type EditorState,
  type CaretTarget,
  type InlineBounds,
  type NormalizedEditorSelection,
  type SelectionFormatting,
} from "@/editor";
import type { DocumentResources } from "@/types";
import {
  equalDocumentCompletions,
  resolveDocumentCompletionContext,
  type DocumentCompletion,
} from "../../completions/document-completions";
import type { CompletionSource } from "../../completions/completions";
import { createComputedSprig, createParameterizedSprig } from "../core/computed";
import {
  equalArrayBy,
  equalArraysByIdentity,
  equalCommentRanges,
  equalCommentStates,
  equalNullableBy,
  equalNormalizedSelections,
  equalSelectionContexts,
} from "../core/equality";
import { renderedLayoutSprig } from "../layout/sprigs";
import { documentIndexSprig, editorStateSprig, selectionSprig } from "./sprigs";

export type { DocumentCompletion } from "../../completions/document-completions";

// Two-point bounding box for a non-collapsed selection. Sprig output is
// nullable (collapsed selections produce no handles); consumers handle
// the null case explicitly.
export type SelectionHandles = {
  end: { left: number; top: number };
  start: { left: number; top: number };
};

export type ImageAtCursor = {
  bounds: InlineBounds;
  inline: IndexedInline;
  maxWidth: number | null;
};

const equalSelectionRanges = equalNullableBy<EditorSelectionRange>((range) => [
  range.regionId,
  range.startOffset,
  range.endOffset,
]);

const equalSelectionHandles = equalNullableBy<SelectionHandles>((handles) => [
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

// Exported because the overlay leaf equality (`equalAnnotationLeaf`) reuses
// it. Identity works on `marks` because marks are immutable in this codebase.
export function equalSelectionFormatting(a: SelectionFormatting, b: SelectionFormatting) {
  return a.supported === b.supported && equalArraysByIdentity(a.marks, b.marks);
}

// Depends on `documentIndexSprig` rather than `editorStateSprig` so selection-
// only transitions don't trigger a `getCommentState` walk. Comment state is
// purely a function of the document; the selection-side change has no effect.
export const commentStateSprig = createComputedSprig(
  [documentIndexSprig],
  (_store, documentIndex) => getCommentState(documentIndex),
  equalCommentStates,
);

// Exported because overlay leaf sprigs depend on it (the comment-thread
// leaf needs the thread list to look up by index).
export const commentThreadsSprig = createComputedSprig(
  [commentStateSprig],
  (_store, commentState) => commentState.threads,
  equalArrayBy(Object.is),
);

// Exported because overlay leaf sprigs depend on it (cursor and pointer
// leaves need ranges to detect commented spans under the caret/hover).
export const commentRangesSprig = createComputedSprig(
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

// Selection-derived sprigs track the selection + documentIndex slices
// rather than the full editor state, so they don't recompute on animation-
// only transitions. The query helpers take a full EditorState, so the body
// reads state imperatively at sprig-fire time; correctness still holds
// because the slices cover everything the queries transitively read.
//
// These three are exported because overlay leaf sprigs depend on them to
// build selection-leaf / annotation-leaf view models.
export const selectionRangeSprig = createComputedSprig(
  [selectionSprig, documentIndexSprig],
  (store) => getSelectionRange(store.editor.getState()),
  equalSelectionRanges,
);

export const selectionFormattingSprig = createComputedSprig(
  [selectionSprig, documentIndexSprig],
  (store) => getSelectionFormatting(store.editor.getState()),
  equalSelectionFormatting,
);

export const selectionHandlesSprig = createComputedSprig(
  [editorStateSprig, normalizedSelectionSprig, renderedLayoutSprig],
  (_store, state, normalizedSelection, layout): SelectionHandles | null => {
    if (!layout) {
      return null;
    }

    return resolveSelectionHandles(state, layout, normalizedSelection);
  },
  equalSelectionHandles,
);

// `normalizedSelectionSprig` already covers selection + documentIndex via
// its own deps, so it's the right subscription target. The rendered layout
// ties the resolution to the painted frame. We read documentIndex / full
// state imperatively because the underlying helpers take a state — but we
// only fire when the selection projection or the layout actually change.
export const caretInViewportSprig = createComputedSprig(
  [normalizedSelectionSprig, renderedLayoutSprig],
  (store, normalizedSelection, layout): boolean => {
    if (!layout) {
      return true;
    }

    const status = resolveCursorViewportStatus(
      store.editor.getState().documentIndex,
      layout,
      normalizedSelection.end,
    );
    return status !== "above" && status !== "below";
  },
);

export const caretTargetSprig = createComputedSprig(
  [normalizedSelectionSprig, renderedLayoutSprig],
  (store, normalizedSelection, layout): CaretTarget | null => {
    if (!layout) {
      return null;
    }

    return measureCaretTarget(store.editor.getState(), layout, normalizedSelection.end);
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

/* Host */

export const selectionContextSprig = createComputedSprig(
  [selectionSprig, documentIndexSprig],
  (store) => getSelectionContext(store.editor.getState()),
  equalSelectionContexts,
);

/* Images */

export const imageAtCursorSprig = createParameterizedSprig(
  [editorStateSprig, normalizedSelectionSprig, renderedLayoutSprig],
  (
    _store,
    [resources]: readonly [DocumentResources | null],
    state,
    normalizedSelection,
    layout,
  ) => {
    if (!resources || !layout) {
      return null;
    }

    return resolveImageAtCursor(state, layout, normalizedSelection, resources);
  },
  equalImageAtCursors,
);

function resolveImageAtCursor(
  state: EditorState,
  layout: EditorLayoutState,
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

  const bounds = measureInlineImageBounds(state, layout, resources, imageInline);
  const maxWidth =
    imageInline.node.type === "image"
      ? (resources.images.get(imageInline.node.url)?.intrinsicWidth ?? null)
      : null;

  return bounds ? { bounds, inline: imageInline, maxWidth } : null;
}

function resolveSelectionHandles(
  state: EditorState,
  layout: EditorLayoutState,
  selection: NormalizedEditorSelection,
): SelectionHandles | null {
  if (selection.collapsed) {
    return null;
  }

  const startCaret = measureVisualCaretTarget(state, layout, selection.start);
  const endCaret = measureVisualCaretTarget(state, layout, selection.end);

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

export const activeCommentIndexSprig = createComputedSprig(
  [editorStateSprig, commentStateSprig],
  (_store, state, commentState) => resolveActiveCommentIndex(state, commentState.ranges),
);

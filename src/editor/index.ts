// Navigation
export {
  moveCaretByViewport,
  moveCaretHorizontally,
  moveCaretToDocumentBoundary,
  moveCaretToLineBoundary,
  moveCaretVertically,
  extendSelectionToPoint,
  resolveDragFocus,
  resolveEditorSearchMatches,
  resolveSelectionPointAt,
  resolveTargetAtOffset,
  resolveWordSelection,
  setSelectionAtPoint,
  updateSelectionFromDrag,
  type EditorHoverTarget,
  type EditorNavigationMode,
  type EditorNavigationOptions,
  type EditorSearchMatch,
} from "./navigation";

// Layout — viewport composition (aliased to public names)
export {
  measureLayoutCaretTarget as measureCaretTarget,
  measureLayoutVisualCaretTarget as measureVisualCaretTarget,
  measureInlineImageBounds,
  createEditorLayoutState,
  CODE_BLOCK_BACKGROUND_PADDING_Y,
  CODE_BLOCK_CONTENT_PADDING_X,
  type EditorPoint,
  type EditorLayoutState,
  type CaretTarget,
  type InlineBounds,
} from "./layout";

export { hasActiveCommentHighlightsInViewport } from "./anchors";
export type {
  TextDecoration,
  TextDecorationIndex,
  TextDecorationRootUpdate,
} from "./text/decorations";
export {
  hasAnimatedDecorations,
  hasAnimatedDecorationsInViewport,
  reconcileTextDecorationIndex,
} from "./text/decorations";
export { createLayoutCache } from "./layout/state/cache";
export {
  createResourceIconSignature,
  createResourceReference,
  hasActiveResourcesInViewport,
  resolveInlineResource,
  resolveResource,
} from "./resources";
export type { ResolvedResource } from "./resources";

// State lifecycle, selection, and commands
export {
  createDocumentFromEditorState as getDocument,
  createEditorState,
  getCaretTextContext,
  getSelectionContext,
  getSelectionFormatting,
  getSelectionRange,
  isRootIndexedBlock,
  normalizeSelection,
  readEditorEffects,
  resolveEditorTextAtPath,
  resolveIndexedBlock,
  resolveIndexedBlockContainingPath,
  resolveIndexedTableCell,
  resolveImageAtSelection,
  setSelection,
  takeEditorEffects,
  type CaretTextContext,
  type DocumentIndex,
  type EditorEffect,
  type IndexedInline,
  type EditorSelection,
  type EditorSelectionPoint,
  type EditorSelectionRange,
  type EditorState,
  type NormalizedEditorSelection,
  type SelectionContext,
  type SelectionFormatting,
  type TextRangeTarget,
} from "./state";

import {
  resolveHoverTarget as resolveNavigationHoverTarget,
  resolveTargetAtOffset,
} from "./navigation";
import { type EditorLayoutState, type EditorPoint } from "./layout";
import { getCommentState, type EditorCommentRange } from "./anchors";
import type { EditorSelectionPoint, EditorState } from "./state";

export function resolveHoverTarget(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
  commentRanges: readonly EditorCommentRange[] = getCommentState(state).ranges,
) {
  return resolveNavigationHoverTarget(state, viewport, point, commentRanges);
}

// Offset-based sibling of `resolveHoverTarget`. The callers we have here
// (selection-driven UI surfacing) don't have a layout point, just a known
// (path, offset), so this skips hit-test and goes straight to the
// state/anchors lookup.
export function resolveTargetAtSelection(state: EditorState, selectionPoint: EditorSelectionPoint) {
  return resolveTargetAtOffset(
    state,
    selectionPoint.path,
    selectionPoint.offset,
    getCommentState(state).ranges,
  );
}

export * from "./state/commands";

// Annotations
export {
  getCommentState,
  resolveActiveCommentIndex,
  resolveCursorViewportStatus,
  resolvePresenceTargets,
  resolvePresenceViewport,
  type EditorCommentRange,
  type EditorCommentState,
  type EditorPresence,
  type EditorPresenceViewport,
  type EditorPresenceViewportStatus,
} from "./anchors";

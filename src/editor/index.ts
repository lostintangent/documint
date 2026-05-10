// Navigation
export {
  moveCaretByViewport,
  moveCaretHorizontally,
  moveCaretToDocumentBoundary,
  moveCaretToLineBoundary,
  moveCaretVertically,
  extendSelectionToPoint,
  setSelectionAtPoint,
  updateSelectionFromDrag,
} from "./navigation";

// Layout — viewport composition (aliased to public names)
export {
  measureLayoutCaretTarget as measureCaretTarget,
  measureLayoutVisualCaretTarget as measureVisualCaretTarget,
  measureInlineImageBounds,
  prepareLayout,
  resolveLayoutDragFocus as resolveDragFocus,
  resolveLayoutSelectionHit as resolveSelectionHit,
  resolveLayoutWordSelection as resolveWordSelection,
  type EditorHoverTarget,
  type EditorPoint,
  type EditorLayoutState,
  type CaretTarget,
  type InlineBounds,
} from "./layout";

// Canvas
export { paintContent, paintOverlay } from "./canvas";
export { createCanvasRenderCache } from "./canvas/lib/cache";
export { hasRunningEditorAnimations as hasRunningAnimations } from "./canvas/lib/animations";

// State lifecycle, selection, and commands
export {
  createDocumentFromEditorState as getDocument,
  createEditorState,
  getCaretTextContext,
  getSelectionContext,
  getSelectionMarks,
  getSelectionRange,
  hasNewAnimation,
  normalizeSelection,
  resolveImageAtSelection,
  setSelection,
  type CaretTextContext,
  type EditorInline,
  type EditorSelection,
  type EditorSelectionPoint,
  type EditorSelectionRange,
  type EditorState,
  type NormalizedEditorSelection,
  type SelectionContext,
  type TextRangeTarget,
} from "./state";

import {
  resolveLayoutHoverTarget,
  resolveLayoutTargetAtSelection,
  type EditorLayoutState,
  type EditorPoint,
} from "./layout";
import { getCommentState } from "./anchors";
import type { EditorSelectionPoint, EditorState } from "./state";

export function resolveHoverTarget(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
) {
  return resolveLayoutHoverTarget(state, viewport, point, getCommentState(state).liveRanges);
}

export function resolveTargetAtSelection(
  state: EditorState,
  viewport: EditorLayoutState,
  selectionPoint: EditorSelectionPoint,
) {
  return resolveLayoutTargetAtSelection(
    state,
    viewport,
    selectionPoint,
    getCommentState(state).liveRanges,
  );
}

export * from "./state/commands";

// Annotations
export {
  getCommentState,
  resolveCursorViewportStatus,
  resolvePresenceCursors,
  resolvePresenceViewport,
  type EditorCommentState,
  type EditorPresence,
  type EditorPresenceViewport,
  type EditorPresenceViewportStatus,
} from "./anchors";

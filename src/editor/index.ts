// Navigation
export {
  moveCaretByViewport,
  moveCaretHorizontally,
  moveCaretToDocumentBoundary,
  moveCaretToLineBoundary,
  moveCaretVertically,
} from "./navigation";

// Layout — viewport composition (aliased to public names)
export {
  measureLayoutCaretTarget as measureCaretTarget,
  measureLayoutVisualCaretTarget as measureVisualCaretTarget,
  measureInlineImageBounds,
  prepareLayout,
  resolveLayoutDragFocus as resolveDragFocus,
  resolveLayoutHoverTarget as resolveHoverTarget,
  resolveLayoutSelectionHit as resolveSelectionHit,
  resolveLayoutTargetAtSelection as resolveTargetAtSelection,
  resolveLayoutWordSelection as resolveWordSelection,
  type EditorHoverTarget,
  type EditorPoint,
  type EditorLayoutState,
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
  getSelectionContext,
  getSelectionMarks,
  hasNewAnimation,
  normalizeSelection,
  resolveImageAtSelection,
  setSelection,
  type EditorInline,
  type EditorSelection,
  type EditorSelectionPoint,
  type EditorState,
  type NormalizedEditorSelection,
} from "./state";

export * from "./state/commands";

// Annotations
export {
  getCommentState,
  resolvePresenceCursors,
  resolvePresenceViewport,
  type EditorCommentState,
  type EditorPresence,
  type EditorPresenceViewport,
} from "./anchors";

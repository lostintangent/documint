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
  measureViewportCaretTarget as measureCaretTarget,
  measureViewportVisualCaretTarget as measureVisualCaretTarget,
  measureInlineImageBounds,
  prepareViewport,
  resolveViewportDragFocus as resolveDragFocus,
  resolveViewportHoverTarget as resolveHoverTarget,
  resolveViewportSelectionHit as resolveSelectionHit,
  resolveViewportTargetAtSelection as resolveTargetAtSelection,
  resolveViewportWordSelection as resolveWordSelection,
  type EditorHoverTarget,
  type EditorPoint,
  type EditorViewportState,
  type InlineBounds,
} from "./layout";

// Canvas
export { paintContent, paintOverlay } from "./canvas/paint";
export { createCanvasRenderCache } from "./canvas/cache";
export { hasRunningEditorAnimations as hasRunningAnimations } from "./canvas/animations";

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

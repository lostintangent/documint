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
  prepareViewport,
  resolveViewportDragFocus as resolveDragFocus,
  resolveViewportHoverTarget as resolveHoverTarget,
  resolveViewportSelectionHit as resolveSelectionHit,
  resolveViewportTargetAtSelection as resolveTargetAtSelection,
  resolveViewportWordSelection as resolveWordSelection,
  type EditorHoverTarget,
  type EditorPoint,
  type EditorViewportState,
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
  setSelection,
  type EditorSelection,
  type EditorSelectionPoint,
  type EditorState,
  type NormalizedEditorSelection,
} from "./state";

export {
  createCommentThread,
  dedent,
  deleteBackward,
  deleteComment,
  deleteCommentThread,
  deleteForward,
  deleteSelectionText as deleteSelection,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  editComment,
  indent,
  insertLineBreak,
  insertSelectionText as replaceSelection,
  insertTable,
  insertTableColumn,
  insertTableRow,
  insertText,
  moveListItemDown,
  moveListItemUp,
  redo,
  removeInlineLink as removeLink,
  replyToCommentThread,
  resolveCommentThread,
  selectAll,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
  toggleTaskItem,
  toggleUnderline,
  undo,
  updateInlineLink as updateLink,
} from "./state/commands";

// Annotations
export {
  getCommentState,
  resolvePresenceCursors,
  resolvePresenceViewport,
  type EditorCommentState,
  type EditorPresence,
} from "./annotations";

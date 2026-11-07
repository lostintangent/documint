// Navigation
export {
  moveCaretByViewport,
  moveCaretByWord,
  moveCaretHorizontally,
  moveCaretToDocumentBoundary,
  moveCaretToLineBoundary,
  moveCaretVertically,
  extendSelectionToPoint,
  isCanvasDirectActivationTarget,
  resolveEditorSearchMatches,
  resolveHoverTarget,
  resolveSelectionPointAt,
  resolveTargetAtOffset,
  resolveWordSelection,
  setSelectionAtPoint,
  updateSelectionFromDrag,
  type EditorHoverTarget,
  type EditorNavigationMode,
} from "./navigation";

// Layout — viewport composition (aliased to public names)
export {
  measureCaretTarget,
  measureVisualCaret,
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
export type { WordMovement } from "./text/words";
export {
  hasAnimatedDecorationsInViewport,
  reconcileTextDecorationIndex,
  remapTextDecorationIndex,
} from "./text/decorations";
export { createLayoutCache } from "./layout/state/cache";
export {
  createResourceIconSignature,
  createResourceReference,
  hasActiveResourcesInViewport,
  resolveResource,
  type DocumentImageResource,
  type DocumentResourceIcon,
  type DocumentResourceIconNode,
  type DocumentResourceIconNodeElement,
  type DocumentResourceProtocol,
  type DocumentResourceReference,
  type DocumentResourceRegistry,
  type DocumentResources,
  type DocumentResourceVectorIcon,
} from "./resources";

// State lifecycle, selection, and commands
export {
  createEditorState,
  getCaretTextContext,
  getSelectionContext,
  getSelectionFormatting,
  getSelectionRange,
  isMetadataPath,
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
} from "./state";

export * from "./state/commands";

// Annotations
export {
  getCommentState,
  resolveActiveCommentIndex,
  resolveCursorViewportStatus,
  resolvePresenceTargets,
  resolvePresenceViewport,
  type DocumentPresence,
  type DocumentUser,
  type DocumentUserPresence,
  type EditorCommentRange,
  type EditorCommentState,
  type EditorPresence,
  type EditorPresenceViewport,
} from "./anchors";

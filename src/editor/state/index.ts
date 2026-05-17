// Build
export {
  createDocumentIndex,
  buildEditorRoots,
  createDocumentFromIndex,
  createEditorRoot,
  rebuildEditorRoot,
  spliceDocumentIndex,
} from "./index/build";

// Types
export type {
  EditorBlock,
  EditorInline,
  EditorListItemMarker,
  DocumentIndex,
  EditorRegion,
  RuntimeLinkAttributes,
  RuntimeMentionAttributes,
} from "./index/types";

// Inline selectors
export { findInlinesInSpan } from "./inlines";

// Selection
export {
  createRegionTarget,
  createRootPrimaryRegionTarget,
  getCaretTextContext,
  getSelectionContext,
  getSelectionFormatting,
  getSelectionRange,
  normalizeSelection,
  resolveImageAtSelection,
  resolveRegionByPath,
  resolveTableCellRegion,
  resolveSelectionTarget,
} from "./selection";

export type {
  CaretTextContext,
  EditorSelection,
  EditorSelectionPoint,
  EditorSelectionRange,
  NormalizedEditorSelection,
  SelectionContext,
  SelectionFormatting,
  SelectionTarget,
} from "./selection";

// Animations
export {
  getEditorAnimationDuration,
  hasRunningEditorAnimations,
} from "./animations";

export type {
  ActiveBlockFlashAnimation,
  TextFadeAnimation,
  EditorAnimation,
  TextHighlightAnimation,
  BlockPulseAnimation,
  TextPulseAnimation,
} from "./animations";

// State
export {
  createDocumentFromEditorState,
  createEditorState,
  redoEditorState,
  setSelection,
  setSelectionPoint,
  undoEditorState,
} from "./reducer/state";

export type { EditorState } from "./types";

export { findAncestorBlockEntry, type TextRangeTarget } from "./commands/context";

// Commands
export * from "./commands";

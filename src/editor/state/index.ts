// Build
export {
  createDocumentIndex,
  buildEditorRoots,
  createDocumentFromIndex,
  createEditorRoot,
  rebuildEditorRoot,
  replaceIndexedDocument,
  spliceDocumentIndex,
} from "./index/build";

// Types
export type {
  EditorInline,
  EditorListItemMarker,
  DocumentIndex,
  EditorRegion,
  RuntimeLinkAttributes,
} from "./index/types";

// Selection
export {
  createDescendantPrimaryRegionTarget,
  createRootPrimaryRegionTarget,
  createTableCellTarget,
  getSelectionContext,
  getSelectionMarks,
  isSelectionCollapsed,
  normalizeSelection,
  resolveRegion,
  resolveRegionByPath,
  resolveTableCellRegion,
  resolveSelectionTarget,
} from "./selection";

export type {
  EditorSelection,
  EditorSelectionPoint,
  NormalizedEditorSelection,
  SelectionContext,
  SelectionTarget,
} from "./selection";

// Reducer
export {
  replaceEditorBlock,
  replaceEditorRoot,
  replaceEditorRootRange,
  replaceSelection,
  updateEditorBlock,
} from "./index/reducer";

// Animations
export {
  addActiveBlockFlashAnimation,
  addDeletedTextFadeAnimation,
  addInsertedTextHighlightAnimation,
  addListMarkerPopAnimation,
  addPunctuationPulseAnimation,
  hasNewAnimation,
} from "./animations";

export type {
  ActiveBlockFlashAnimation,
  DeletedTextFadeAnimation,
  EditorAnimation,
  InsertedTextHighlightAnimation,
  ListMarkerPopAnimation,
  PunctuationPulseAnimation,
} from "./animations";

// State
export {
  createDocumentFromEditorState,
  createEditorState,
  redoEditorState,
  setSelection,
  setSelectionPoint,
  spliceEditorCommentThreads,
  undoEditorState,
} from "./state";

export type { EditorState } from "./state";

// Commands
export * from "./commands";

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
  EditorInline,
  EditorListItemMarker,
  DocumentIndex,
  EditorRegion,
  RuntimeLinkAttributes,
} from "./index/types";

// Selection
export {
  createRootPrimaryRegionTarget,
  getSelectionContext,
  getSelectionMarks,
  normalizeSelection,
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

// Animations
export {
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
  undoEditorState,
} from "./reducer/state";

export type { EditorState } from "./types";

// Commands
export * from "./commands";

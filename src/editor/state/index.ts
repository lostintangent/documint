// Build
export { commitDocument, createDocumentIndex, spliceDocumentIndex } from "./index/splice";

// Types
export type {
  IndexedBlock,
  DocumentIndex,
  IndexedInline,
  IndexedListItem,
  EditableRegion,
} from "./index/types";

// Inline selectors
export {
  findInlinesInRange,
  inlineMarks,
  indexedInlineText,
  regionInlines,
} from "./index/inlines";

// Index queries
export {
  // Lookups
  countRootBlocks,
  resolveBlockByPath,
  resolveIndexedBlock,
  resolveIndexedBlockForRegion,
  resolveRegion,
  resolveRootBlock,
  resolveRootRegions,
  resolveSiblingRootBlock,

  // Comment projection
  resolveCommentThreadIndicesForRegion,

  // Block and region extents
  blockContainsBlock,
  findAncestorIndexedBlockByPath,
  firstRegionInBlock,
  lastRegionInBlock,
  resolveParentIndexedBlock,
  resolvePrimaryRegionForBlockPath,
  resolveRootPrimaryRegion,
  resolveTableCellRegionByTablePath,

  // Document flow
  compareEditorPositions,
  firstInFlowRegionOfRoot,
  nextBlockInFlow,
  nextRegionInFlow,
  previousBlockInFlow,
  previousRegionInFlow,
  resolveDocumentBoundaryRegion,
  resolveRegionOutsideRoot,

  // Shape and classification
  findUniqueEditableRegion,
  hasSameEditableRegionShape,
  hasSameTableCellPosition,
  isContainerBlock,
  isInertBlock,
  isInlineRegion,
  isRootIndexedBlock,
  isSourceRegion,

  // Active handles
  resolveActiveBlockKey,
} from "./index/query";

// Selection
export {
  areSelectionPointsEqual,
  getCaretTextContext,
  getSelectionContext,
  getSelectionFormatting,
  getSelectionRange,
  isSelectionCollapsed,
  normalizeSelection,
  resolveImageAtSelection,
  selectionIntersectsBlockPath,
  selectionIntersectsRegion,
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

// Semantic effects
export { readEditorEffects, takeEditorEffects } from "./effects";
export type {
  ActiveBlockChangedEffect,
  EditorEffect,
  ListItemInsertedEffect,
  TextDeletedEffect,
  TextInsertedEffect,
} from "./effects";

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

export type { TextRangeTarget } from "./commands/context";

// Commands
export * from "./commands";

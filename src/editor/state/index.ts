// Build
export { commitDocument, createDocumentIndex, spliceDocumentIndex } from "./index/splice";

// Types
export type {
  IndexedBlock,
  BlockKind,
  DocumentIndex,
  IndexedInline,
  IndexedListItem,
  EditableRegion,
  IndexedRoot,
} from "./index/types";

// Inline selectors
export {
  findInlinesInRange,
  inlineMarks,
  indexedInlineText,
  projectInlineText,
  regionInlines,
} from "./index/inlines";

// Index queries
export {
  compareEditorPositions,
  countRootBlocks,
  createSemanticRegionIndex,
  findAncestorIndexedBlock,
  firstInFlowRegionOfRoot,
  isContainerBlock,
  isInertBlock,
  isInlineRegion,
  isSourceRegion,
  isRootIndexedBlock,
  nextBlockInFlow,
  nextRegionInFlow,
  previousBlockInFlow,
  previousRegionInFlow,
  resolveActiveBlockKey,
  resolveBlock,
  resolveBlockChildIndices,
  resolveDocumentNodeRegion,
  resolveIndexedBlock,
  resolveIndexedBlockForRegion,
  resolveBlockPathForRegion,
  resolveCommentThreadIndicesForRegion,
  resolveDescendantPrimaryRegion,
  resolveDocumentBoundaryRegion,
  resolveParentIndexedBlock,
  resolvePrimaryRegion,
  resolveRegion,
  resolveRegionByPath,
  resolveRegionDocumentNode,
  resolveRegionOutsideRoot,
  resolveRootBlock,
  resolveRootPrimaryRegion,
  resolveRootRegions,
  resolveSiblingRootBlock,
  resolveTableCellPosition,
  resolveTableCellRegion,
} from "./index/query";

export type { EditorIndexPosition } from "./index/query";

// Selection
export {
  getCaretTextContext,
  getSelectionContext,
  getSelectionFormatting,
  getSelectionRange,
  isSelectionCollapsed,
  normalizeSelection,
  resolveImageAtSelection,
  selectionIntersectsBlock,
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

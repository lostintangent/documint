// Build
export { createDocumentIndex, spliceDocumentIndex } from "./index/splice";
// Types
export type {
  IndexedBlock,
  DocumentIndex,
  IndexedInline,
  IndexedListItem,
  IndexedTableCell,
} from "./index/types";

// Inline selectors
export {
  findInlinesInRange,
  inlineMarks,
  indexedInlineText,
  indexedOffsetToPlainTextOffset,
  plainTextOffsetToIndexedOffset,
} from "./index/inlines";
export type { InlineOffsetAffinity } from "./index/inlines";

// Index queries
export {
  // Lookups
  countRootBlocks,
  metadataKeyPath,
  metadataValuePath,
  resolveBlockByPath,
  resolveIndexedBlock,
  resolveMetadataField,
  resolveIndexedText,
  resolveIndexedTextInlines,
  resolveIndexedTableCell,
  resolveInlinesAtPath,
  resolveIndexedBlockContainingPath,
  resolveEditorTextAtPath,

  // Comment projection
  resolveCommentThreadIndicesForPath,

  // Block extents
  findAncestorIndexedBlockByPath,
  resolveParentIndexedBlock,
  resolveIndexedTableCellByTablePath,

  // Document flow
  compareEditorPositions,
  compareResolvedEditorPositions,
  countEditorPathsWithText,
  findEditorPathWithText,
  findUniqueEditorPathWithText,
  forEachEditorPathWithText,
  resolveAdjacentEditorPathWithTextOutsideBlock,
  resolveAdjacentEditorPathWithTextInFlow,
  nextBlockInFlow,
  previousBlockInFlow,
  resolveBlockTextPathBoundary,
  resolveDocumentTextPathBoundary,
  resolveEditorPosition,

  // Shape and classification
  hasSameEditorTextPathShape,
  isContainerBlock,
  isInertBlock,
  isMetadataPath,
  isRootIndexedBlock,
} from "./index/query";
export type { ResolvedEditorPosition } from "./index/query";

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
  selectionIntersectsPath,
} from "./selection";

export type {
  EditorSelection,
  EditorSelectionPoint,
  EditorSelectionRange,
  NormalizedEditorSelection,
  SelectionContext,
  SelectionFormatting,
} from "./selection";

// Semantic effects
export { readEditorEffects, takeEditorEffects } from "./effects";
export type { EditorEffect, TextDeletedEffect, TextInsertedEffect } from "./effects";

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

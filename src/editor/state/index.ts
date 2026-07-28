// Build
export { commitDocument, createDocumentIndex, spliceDocumentIndex } from "./index/splice";

// Types
export type {
  IndexedBlock,
  DocumentIndex,
  IndexedInline,
  IndexedListItem,
  IndexedTableCell,
  IndexedText,
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
  resolveBlockByPath,
  resolveIndexedBlock,
  resolveIndexedText,
  resolveIndexedTextInlines,
  resolveIndexedTextKind,
  resolveIndexedTableCell,
  resolveInlinesAtPath,
  resolveIndexedBlockContainingPath,
  resolveRootBlock,
  resolveSiblingRootBlock,
  resolveEditorTextAtPath,

  // Comment projection
  resolveCommentThreadIndicesForPath,

  // Block extents
  blockContainsBlock,
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
  isEditorTextPathMergeable,
  isInertBlock,
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

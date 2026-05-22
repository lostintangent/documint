// Build
export {
  commitDocument,
  createDocumentIndex,
  spliceDocumentIndex,
} from "./index/splice";

// Types
export type {
  BlockEntry,
  BlockKind,
  DocumentIndex,
  InlineEntry,
  ListItemMarker,
  RegionEntry,
  RootEntry,
} from "./index/types";

// Inline selectors
export { findInlinesInSpan, regionInlines } from "./index/inlines";

// Index queries
export {
  compareEditorPositions,
  countRootBlocks,
  createSemanticRegionIndex,
  findAncestorBlockEntry,
  firstInFlowRegionOfRoot,
  isContainerBlock,
  isInertBlock,
  isRootBlockEntry,
  nextBlockInFlow,
  nextRegionInFlow,
  previousBlockInFlow,
  previousRegionInFlow,
  resolveActiveBlockKey,
  resolveBlock,
  resolveBlockChildIndices,
  resolveBlockEntry,
  resolveBlockEntryForRegion,
  resolveBlockPathForRegion,
  resolveCommentThreadIndicesForRegion,
  resolveDescendantPrimaryRegion,
  resolveDocumentBoundaryRegion,
  resolveParentBlockEntry,
  resolvePrimaryRegion,
  resolveRegion,
  resolveRegionByPath,
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
  createRegionTarget,
  createRootPrimaryRegionTarget,
  getCaretTextContext,
  getSelectionContext,
  getSelectionFormatting,
  getSelectionRange,
  normalizeSelection,
  resolveImageAtSelection,
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

export type { TextRangeTarget } from "./commands/context";

// Commands
export * from "./commands";

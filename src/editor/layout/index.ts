// Public document-geometry boundary for the editor layout subsystem. This surface
// answers where content is, which line a point lands in, and where a caret
// should render within the prepared layout.

export type { DocumentLayout, LayoutRect, PathBounds } from "./measure";
export type { MetadataLayout } from "./measure/metadata";
export type { EditorLayoutState } from "./state";
export type { CaretTarget, InlineBounds } from "./query";

export {
  // Resolve lines within the prepared layout.
  findDocumentLayoutLineEntryForPathOffset as findLineEntryForPathOffset,
  findDocumentLayoutLineForPathOffset as findLineForPathOffset,
  findDocumentLayoutBlockRange as findVisibleBlockRange,
  findDocumentLayoutLineRange as findVisibleLineRange,
  findDocumentLayoutTableRowRange as findVisibleTableRowRange,
  someVisibleDocumentLayoutLine,

  // Resolve point and caret geometry.
  measureDocumentCaretTarget as measureCaretTarget,
  measureDocumentVisualCaret as measureVisualCaret,
  measureCanvasLineOffsetLeft as measureLineOffsetLeft,

  // Resolve geometry against prepared layout.
  measureInlineImageBounds,
  resolveCaretHitTestX,
  resolveInlineImageBounds,
  resolveListMarkerTarget,
  type ListMarkerTarget,
  resolveOrderedListMarkerAnchor,
  resolveTaskCheckboxBounds,
  resolveUnorderedListMarkerBounds,
  resolvePositionInViewport,
  resolveScrollTopToReveal,
} from "./query";
export { CODE_BLOCK_BACKGROUND_PADDING_Y, CODE_BLOCK_CONTENT_PADDING_X } from "./lib/code-block";
export { resolveBlockSurfaceLeft } from "./lib/content-metrics";

export {
  // Build the editor layout state for the current viewport.
  createEditorLayoutState,
} from "./state";

export type EditorPoint = {
  x: number;
  y: number;
};

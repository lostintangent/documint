// Owns the query API for a prepared `DocumentLayout`. These reads sit on
// top of finished geometry: point-to-line lookup, caret target measurement,
// visible-range lookups, and visual helpers shared with paint and navigation.

export {
  measureDocumentCaretTarget,
  measureDocumentVisualCaret,
  resolveCaretHitTestX,
  type CaretTarget,
} from "./caret";

export {
  measureInlineImageBounds,
  resolveInlineImageBounds,
  resolveListMarkerTarget,
  resolveOrderedListMarkerAnchor,
  resolveTaskCheckboxBounds,
  resolveUnorderedListMarkerBounds,
  type InlineBounds,
  type ListMarkerTarget,
} from "./line-visuals";

export {
  findDocumentLayoutLineEntryForPathOffset,
  findDocumentLayoutLineForPathOffset,
  measureCanvasLineOffsetLeft,
} from "./line-lookup";

export {
  findDocumentLayoutBlockRange,
  findDocumentLayoutLineRange,
  findDocumentLayoutTableRowRange,
  someVisibleDocumentLayoutLine,
} from "./viewport-ranges";

export { resolvePositionInViewport, resolveScrollTopToReveal } from "./viewport-position";

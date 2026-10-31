// Owns the query API for a prepared `DocumentLayout`. These reads sit on
// top of finished geometry: point-to-line lookup, caret target measurement,
// visible-range lookups, and visual helpers shared with paint and navigation.

export {
  measureDocumentCaretTarget,
  measureDocumentVisualCaret,
  resolveCaretHitTestX,
  resolveCaretVisualLeft,
  type CaretTarget,
} from "./caret";

export {
  measureInlineImageBounds,
  resolveListMarkerTarget,
  resolveOrderedListMarkerAnchor,
  resolveTaskCheckboxBounds,
  resolveUnorderedListMarkerBounds,
  type InlineBounds,
  type ListMarkerTarget,
} from "./line-visuals";

export {
  findDocumentLayoutLineAtPoint,
  findDocumentLayoutLineEntryForPathOffset,
  findDocumentLayoutLineForPathOffset,
  findNearestDocumentLayoutLineForPath,
  measureCanvasLineOffsetLeft,
} from "./line-lookup";

export {
  findDocumentLayoutBlockRange,
  findDocumentLayoutLineRange,
  someVisibleDocumentLayoutLine,
} from "./viewport-ranges";

export {
  resolvePositionInViewport,
  resolveScrollTopToReveal,
  type ScrollRevealAlignment,
  type ViewportPositionStatus,
} from "./viewport-position";

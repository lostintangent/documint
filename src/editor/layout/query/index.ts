// Owns the query API for a prepared `DocumentLayout`. These reads sit on
// top of finished geometry: point-to-line testing, caret target measurement,
// visible-range lookups, and visual helpers shared with paint and navigation.

export {
  measureDocumentCaretTarget,
  resolveCaretHitTestX,
  resolveCaretVisualLeft,
  type DocumentCaretTarget,
} from "./caret";

export {
  measureInlineImageBounds,
  resolveLineVisualLeft,
  resolveIndexedListItem,
  resolveListMarkerTarget,
  resolveOrderedListMarkerAnchor,
  resolveTaskCheckboxBounds,
  resolveUnorderedListMarkerBounds,
  type InlineBounds,
  type ListMarkerTarget,
} from "./line-visuals";

export { hitTestDocumentLayout, type DocumentHitTestResult } from "./hit-test";

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

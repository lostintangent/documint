// Owns the query API for a prepared `DocumentLayout`. These reads sit on
// top of finished geometry — pointer hit-testing, caret target measurement,
// visible-range lookups, link/checkbox/hover targeting, and the visual
// helpers shared with paint and navigation.

export {
  measureDocumentCaretTarget,
  resolveCaretVisualLeft,
  type DocumentCaretTarget,
} from "./caret";

export {
  resolveLineContentInset,
  resolveLineVisualLeft,
  resolveListItemMarker,
  resolveTaskCheckboxBounds,
} from "./geometry";

export {
  hitTestDocumentLayout,
  resolveDragFocusPoint,
  resolveEditorHitAtPoint,
  resolveHitBelowLayout,
  resolveWordSelectionAtPoint,
  type DocumentHitTestResult,
} from "./hit-test";

export {
  findDocumentLayoutBlockRange,
  findDocumentLayoutLineAtPoint,
  findDocumentLayoutLineEntryForRegionOffset,
  findDocumentLayoutLineForRegionOffset,
  findDocumentLayoutLineRange,
  findNearestDocumentLayoutLineForRegion,
  measureCanvasLineOffsetLeft,
} from "./lookup";

export { resolvePositionInViewport, type ViewportPositionStatus } from "./position";

export {
  measureInlineImageBounds,
  resolveHoverTargetAtPoint,
  resolveLinkHitAtPoint,
  resolveTargetAtOffset,
  resolveTaskCheckboxHitAtPoint,
  type EditorHoverTarget,
  type InlineBounds,
} from "./targets";

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
  findBlockAncestor,
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
  findDocumentLayoutLineAtY,
  findDocumentLayoutLineEntryForRegionOffset,
  findDocumentLayoutLineForRegionOffset,
  findDocumentLayoutLineRange,
  findNearestDocumentLayoutLineForRegion,
  measureCanvasLineOffsetLeft,
  resolveBoundaryOffset,
} from "./lookup";

export {
  measureInlineImageBounds,
  resolveHoverTargetAtPoint,
  resolveLinkHitAtPoint,
  resolveTargetAtSelectionPoint,
  resolveTaskCheckboxHitAtPoint,
  type CanvasCheckboxHit,
  type CanvasLinkHit,
  type EditorHoverTarget,
  type InlineBounds,
} from "./targets";

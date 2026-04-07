// Public document-geometry boundary for the editor layout subsystem. This surface
// answers where content is, which line or region a point lands in, and
// where a caret should render within the prepared layout.

export type {
  DocumentCaretTarget as CaretTarget,
  ViewportLayout,
  DocumentHitTestResult as LayoutSelectionHit,
  ViewportLayoutLine as LayoutLine,
  DocumentLayoutOptions as LayoutOptions,
  DocumentLineBoundary as LineBoundary,
  LayoutEstimate,
} from "./document";
export type { CanvasViewport, DocumentViewport } from "./viewport";
export type {
  CanvasCheckboxHit,
  CanvasLinkHit,
  EditorHoverTarget,
} from "./hit-test";

export {
  // Build and estimate document geometry.
  createDocumentLayout,
  estimateLayout,

  // Resolve lines within the prepared layout.
  findDocumentLayoutLineAtPoint as findLineAtPoint,
  findDocumentLayoutLineAtY as findLineAtY,
  findDocumentLayoutLineEntryForRegionOffset as findLineEntryForRegionOffset,
  findDocumentLayoutLineForRegionOffset as findLineForRegionOffset,
  findDocumentLayoutLineRange as findVisibleLineRange,
  findNearestDocumentLayoutLineForRegion as findNearestLineInRegion,

  // Resolve selection and caret geometry.
  hitTestDocumentLayout as resolveSelectionHit,
  measureDocumentCaretTarget as measureCaretTarget,
  measureCanvasLineOffsetLeft as measureLineOffsetLeft,
} from "./document";

export {
  // Build the viewport-oriented document layout wrapper.
  createDocumentViewport,
} from "./viewport";

export {
  // Resolve pointer and hover interactions against prepared layout.
  findBlockAncestor,
  resolveCaretVisualLeft,
  resolveDragFocusPointAtLocation,
  resolveEditorHitAtPoint,
  resolveHoverTargetAtPoint,
  resolveLinkHitAtPoint,
  resolveLineContentInset,
  resolveLineVisualLeft,
  resolveListItemMarker,
  resolveTargetAtSelectionPoint,
  resolveTaskCheckboxBounds,
  resolveTaskCheckboxHitAtPoint,
  resolveWordSelectionAtPoint,
} from "./hit-test";

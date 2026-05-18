// Public document-geometry boundary for the editor layout subsystem. This surface
// answers where content is, which line or region a point lands in, and
// where a caret should render within the prepared layout.

import type { EditorCommentState } from "../anchors";
import type { EditorSelectionPoint, EditorState } from "../state";

export type {
  DocumentLayout,
  DocumentLayoutOptions,
} from "./measure";
export type { EditorLayoutState } from "./state";
export type {
  DocumentCaretTarget as CaretTarget,
  EditorHoverTarget,
  InlineBounds,
} from "./query";

export {
  // Estimate document geometry.
  estimateLayout,
} from "./measure";

export {
  // Resolve lines within the prepared layout.
  findDocumentLayoutLineEntryForRegionOffset as findLineEntryForRegionOffset,
  findDocumentLayoutLineForRegionOffset as findLineForRegionOffset,
  findDocumentLayoutBlockRange as findVisibleBlockRange,
  findDocumentLayoutLineRange as findVisibleLineRange,

  // Resolve selection and caret geometry.
  hitTestDocumentLayout,
  measureDocumentCaretTarget as measureCaretTarget,
  measureCanvasLineOffsetLeft as measureLineOffsetLeft,

  // Resolve pointer and hover interactions against prepared layout. The raw
  // forms below are the editor-internal primitives — `navigation/`, the
  // renderer, and tests reach for them. The editor-facing wrappers
  // (`resolveLayout*` below) compose these for the React host.
  measureInlineImageBounds,
  resolveCaretHitTestX,
  resolveCaretVisualLeft,
  resolveDragFocusPoint,
  resolveEditorHitAtPoint,
  resolveLineContentInset,
  resolveLineVisualLeft,
  resolveLinkHitAtPoint,
  resolveListItemMarker,
  resolveTargetAtOffset,
  resolveTaskCheckboxBounds,
  resolveWordSelectionAtPoint,
  resolvePositionInViewport,
  type ViewportPositionStatus,
} from "./query";

export {
  // Build the editor layout state for the current viewport.
  createEditorLayoutState,
} from "./state";

import type { EditorLayoutState } from "./state";
import { measureDocumentCaretTarget, resolveCaretVisualLeft } from "./query/caret";
import {
  resolveEditorHitAtPoint,
  resolveHitBelowLayout,
  resolveDragFocusPoint,
  resolveWordSelectionAtPoint,
} from "./query/hit-test";
import { resolveHoverTargetAtPoint, type EditorHoverTarget } from "./query/targets";

export type EditorPoint = {
  x: number;
  y: number;
};

export type SelectionHit = {
  regionId: string;
  offset: number;
};

export function resolveLayoutSelectionHit(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
): SelectionHit | null {
  return (
    resolveEditorHitAtPoint(viewport.layout, state, point) ??
    resolveHitBelowLayout(viewport.layout, state, point)
  );
}

export function resolveLayoutDragFocus(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
  anchor: EditorSelectionPoint,
): SelectionHit | null {
  return resolveDragFocusPoint(viewport.layout, state, point, anchor);
}

export function resolveLayoutWordSelection(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
) {
  return resolveWordSelectionAtPoint(viewport.layout, state, point);
}

export function resolveLayoutHoverTarget(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
  commentRanges: EditorCommentState["ranges"],
): EditorHoverTarget | null {
  return resolveHoverTargetAtPoint(viewport.layout, state, point, commentRanges);
}

export function measureLayoutCaretTarget(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorSelectionPoint,
) {
  return measureDocumentCaretTarget(viewport.layout, state.documentIndex, point);
}

export function measureLayoutVisualCaretTarget(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorSelectionPoint,
) {
  const caret = measureDocumentCaretTarget(viewport.layout, state.documentIndex, point);

  if (!caret) {
    return null;
  }

  return {
    ...caret,
    left: resolveCaretVisualLeft(state, viewport.layout, caret),
  };
}

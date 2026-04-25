// Public document-geometry boundary for the editor layout subsystem. This surface
// answers where content is, which line or region a point lands in, and
// where a caret should render within the prepared layout.

import type { Block, Mark } from "@/document";
import type { EditorCommentState, EditorPresence } from "../annotations";
import type { CanvasRenderCache } from "../canvas/cache";
import type { DocumentResources } from "@/types";
import type { EditorSelectionPoint, EditorState, NormalizedEditorSelection } from "../state";

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
export type { CanvasCheckboxHit, CanvasLinkHit, EditorHoverTarget } from "./hit-test";

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
  resolveDragFocusPoint,
  resolveEditorHitAtPoint,
  resolveHitBelowLayout,
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

import {
  createDocumentViewport,
  type CanvasViewport,
} from "./viewport";
import type { DocumentLayoutOptions, ViewportLayout } from "./document";
import {
  measureDocumentCaretTarget,
  buildDocumentBlockMap,
} from "./document";
import {
  resolveCaretVisualLeft,
  resolveDragFocusPoint,
  resolveEditorHitAtPoint,
  resolveHitBelowLayout,
  resolveHoverTargetAtPoint,
  resolveTargetAtSelectionPoint,
  resolveWordSelectionAtPoint,
  type EditorHoverTarget,
} from "./hit-test";

/* Viewport types */

export type ContainerLineBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type EditorViewport = {
  height: number;
  top: number;
};

export type EditorViewportState = {
  estimateRegionBounds: (regionId: string) => { bottom: number; top: number } | null;
  regionBounds: Map<string, ContainerLineBounds>;
  layout: ViewportLayout;
  paintHeight: number;
  paintTop: number;
  totalHeight: number;
  viewport: EditorViewport;
  blockMap: Map<string, Block>;
};

export type EditorPoint = {
  x: number;
  y: number;
};

export type SelectionHit = {
  regionId: string;
  offset: number;
};

/* Viewport composition */

export function prepareViewport(
  state: EditorState,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width"> & EditorViewport,
  renderCache: CanvasRenderCache,
  resources: DocumentResources | null = null,
): EditorViewportState {
  const viewport: CanvasViewport = {
    height: options.height,
    overscan: Math.max(160, options.height),
    top: options.top,
  };
  const viewportLayout = createDocumentViewport(
    state.documentIndex,
    options,
    viewport,
    [state.selection.anchor.regionId, state.selection.focus.regionId],
    renderCache,
    resources,
  );

  return {
    blockMap: buildDocumentBlockMap(state.documentIndex.document.blocks),
    estimateRegionBounds: viewportLayout.estimateRegionBounds,
    regionBounds: new Map(viewportLayout.layout.regionBounds),
    layout: viewportLayout.layout,
    paintHeight: Math.max(240, viewport.height + viewport.overscan * 2),
    paintTop: Math.max(0, viewport.top - viewport.overscan),
    totalHeight: viewportLayout.totalHeight,
    viewport: {
      height: viewport.height,
      top: viewport.top,
    },
  };
}

export function resolveViewportSelectionHit(
  state: EditorState,
  viewport: EditorViewportState,
  point: EditorPoint,
): SelectionHit | null {
  return (
    resolveEditorHitAtPoint(viewport.layout, state, point) ??
    resolveHitBelowLayout(viewport.layout, state, point)
  );
}

export function resolveViewportDragFocus(
  state: EditorState,
  viewport: EditorViewportState,
  point: EditorPoint,
  anchor: EditorSelectionPoint,
): SelectionHit | null {
  return resolveDragFocusPoint(viewport.layout, state, point, anchor);
}

export function resolveViewportWordSelection(
  state: EditorState,
  viewport: EditorViewportState,
  point: EditorPoint,
) {
  return resolveWordSelectionAtPoint(viewport.layout, state, point);
}

export function resolveViewportHoverTarget(
  state: EditorState,
  viewport: EditorViewportState,
  point: EditorPoint,
  liveCommentRanges: EditorCommentState["liveRanges"],
): EditorHoverTarget | null {
  return resolveHoverTargetAtPoint(viewport.layout, state, point, liveCommentRanges);
}

export function resolveViewportTargetAtSelection(
  state: EditorState,
  viewport: EditorViewportState,
  selectionPoint: EditorSelectionPoint,
  liveCommentRanges: EditorCommentState["liveRanges"],
): EditorHoverTarget | null {
  return resolveTargetAtSelectionPoint(
    viewport.layout,
    state,
    selectionPoint,
    liveCommentRanges,
  );
}

export function measureViewportCaretTarget(
  state: EditorState,
  viewport: EditorViewportState,
  point: EditorSelectionPoint,
) {
  return measureDocumentCaretTarget(viewport.layout, state.documentIndex, point);
}

export function measureViewportVisualCaretTarget(
  state: EditorState,
  viewport: EditorViewportState,
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

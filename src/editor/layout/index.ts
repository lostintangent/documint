// Public document-geometry boundary for the editor layout subsystem. This surface
// answers where content is, which line a point lands in, and where a caret
// should render within the prepared layout.

import type { EditorSelectionPoint, EditorState } from "../state";

export type { DocumentLayout, DocumentLayoutOptions, LayoutRect } from "./measure";
export type { EditorLayoutState } from "./state";
export type { DocumentCaretTarget as CaretTarget, InlineBounds } from "./query";

export {
  // Resolve lines within the prepared layout.
  findDocumentLayoutLineEntryForRegionOffset as findLineEntryForRegionOffset,
  findDocumentLayoutLineForRegionOffset as findLineForRegionOffset,
  findDocumentLayoutBlockRange as findVisibleBlockRange,
  findDocumentLayoutLineRange as findVisibleLineRange,
  someVisibleDocumentLayoutLine,

  // Resolve point and caret geometry.
  hitTestDocumentLayout,
  measureDocumentCaretTarget as measureCaretTarget,
  measureCanvasLineOffsetLeft as measureLineOffsetLeft,

  // Resolve geometry against prepared layout.
  measureInlineImageBounds,
  resolveCaretHitTestX,
  resolveCaretVisualLeft,
  resolveLineVisualLeft,
  resolveIndexedListItem,
  resolveListMarkerTarget,
  resolveOrderedListMarkerAnchor,
  resolveTaskCheckboxBounds,
  resolveUnorderedListMarkerBounds,
  resolvePositionInViewport,
  resolveScrollTopToReveal,
  type ScrollRevealAlignment,
  type ViewportPositionStatus,
} from "./query";
export { CODE_BLOCK_BACKGROUND_PADDING_Y, CODE_BLOCK_CONTENT_PADDING_X } from "./lib/code-block";

export {
  // Build the editor layout state for the current viewport.
  createEditorLayoutState,
} from "./state";

import type { EditorLayoutState } from "./state";
import { measureDocumentCaretTarget, resolveCaretVisualLeft } from "./query/caret";

export type EditorPoint = {
  x: number;
  y: number;
};

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
